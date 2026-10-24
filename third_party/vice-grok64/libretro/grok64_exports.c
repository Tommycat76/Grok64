#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#endif

#include "libretro.h"
#include "attach.h"
#include "diskimage.h"
#include "fliplist.h"
#include "kbdbuf.h"
#include "machine.h"
#include "vdrive/vdrive.h"
#include "vdrive/vdrive-bam.h"
#include "drive/drive.h"
#include "cbmdos.h"
#include "vice-event.h"
#include "resources.h"
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

extern char retro_save_directory[];

#ifdef GROK64_SD2IEC
extern void grok64_sd2iec_disable_unit(int unit);
#endif

int grok64_disk_attach(int unit, int drive, const char *path);
int grok64_drive_reload_image(int unit, int drive);
int grok64_drive_iec_device(int unit);

#define GROK64_DISK_PATH_MAX 4096
static int pending_disk_unit = 0;
static int pending_disk_drive = 0;
static char pending_disk_path[GROK64_DISK_PATH_MAX];
static int pending_disk_attach = 0;
static int last_disk_attach_rc = -1;
static char last_disk_attach_diag[384];

static void grok64_note_attach_diag(const char *msg)
{
    if (!msg) {
        last_disk_attach_diag[0] = '\0';
        return;
    }
    strlcpy(last_disk_attach_diag, msg, sizeof(last_disk_attach_diag));
}

static void grok64_disk_route_to_drive(unsigned int unit)
{
    char res[32];

    if (unit < 8 || unit > 11) {
        return;
    }
#ifdef GROK64_SD2IEC
    grok64_sd2iec_disable_unit((int)unit);
#endif
    snprintf(res, sizeof(res), "IECDevice%u", unit);
    resources_set_int(res, 0);
    snprintf(res, sizeof(res), "FileSystemDevice%u", unit);
    resources_set_int(res, ATTACH_DEVICE_NONE);
}

static int grok64_fs_size_bytes(const char *path)
{
    struct stat st;

    if (!path || !path[0]) {
        return -EINVAL;
    }
    if (stat(path, &st) != 0) {
        return -errno;
    }
    if (!S_ISREG(st.st_mode)) {
        return -EINVAL;
    }
    if (st.st_size > 0x7fffffff) {
        return -EFBIG;
    }
    return (int)st.st_size;
}

extern void cartridge_trigger_freeze(void);
extern void retro_keyboard_event(bool down, unsigned code, uint32_t character, uint16_t mod);

static void grok64_kbdbuf_ensure(void)
{
    kbdbuf_reset(631, 198, 10, (CLOCK)machine_get_cycles_per_frame());
}

#ifdef GROK64_SD2IEC

extern void grok64_sd2iec_enable_unit(int unit);
extern void grok64_sd2iec_disable_unit(int unit);

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
void grok64_sd2iec_attach(int unit)
{
    grok64_sd2iec_enable_unit(unit);
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
void grok64_sd2iec_detach(int unit)
{
    grok64_sd2iec_disable_unit(unit);
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
void grok64_sd2iec_poll(void)
{
    if (pending_disk_attach && pending_disk_path[0] && pending_disk_unit >= 8) {
        pending_disk_attach = 0;
        grok64_disk_attach(pending_disk_unit, pending_disk_drive, pending_disk_path);
    }
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
uint8_t grok64_c64_read(uint16_t addr)
{
    void *data = retro_get_memory_data(RETRO_MEMORY_SYSTEM_RAM);
    size_t size = retro_get_memory_size(RETRO_MEMORY_SYSTEM_RAM);
    if (!data || addr >= size) {
        return 0;
    }
    return ((uint8_t *)data)[addr];
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
void grok64_c64_write(uint16_t addr, uint8_t value)
{
    void *data = retro_get_memory_data(RETRO_MEMORY_SYSTEM_RAM);
    size_t size = retro_get_memory_size(RETRO_MEMORY_SYSTEM_RAM);
    if (!data || addr >= size) {
        return;
    }
    ((uint8_t *)data)[addr] = value;
}

#endif

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int grok64_kbdbuf_feed(const char *text)
{
    if (!text) {
        return -1;
    }
    grok64_kbdbuf_ensure();
    return kbdbuf_feed_string(text);
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
void grok64_kbdbuf_flush(void)
{
    grok64_kbdbuf_ensure();
    kbdbuf_flush();
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int grok64_kbdbuf_feed_runcmd(const char *text)
{
    if (!text) {
        return -1;
    }
    grok64_kbdbuf_ensure();
    return kbdbuf_feed_runcmd(text);
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
void grok64_cartridge_trigger_freeze(void)
{
    cartridge_trigger_freeze();
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
void grok64_retro_keyboard(unsigned code, int down, unsigned character, unsigned mod)
{
    retro_keyboard_event(down != 0, code, character, (uint16_t)mod);
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
const char *grok64_disk_get_name(int unit, int drive)
{
    const char *name;
    vdrive_t *vdrive;
    disk_image_t *image;

    if (unit < 8 || unit > 11) {
        return "";
    }
    if (drive < 0 || drive > 1) {
        drive = 0;
    }

    name = file_system_get_disk_name((unsigned int)unit, (unsigned int)drive);
    if (name && name[0]) {
        return name;
    }

    vdrive = file_system_get_vdrive((unsigned int)unit);
    image = vdrive ? vdrive_get_image(vdrive, (unsigned int)drive) : NULL;
    if (image) {
        name = disk_image_fsimage_name_get(image);
        if (name && name[0]) {
            return name;
        }
    }

    name = fliplist_get_head((unsigned int)unit);
    if (name && name[0]) {
        return name;
    }

    return "";
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
void grok64_disk_detach(int unit, int drive)
{
    if (unit < 8 || unit > 11) {
        return;
    }
    if (drive < 0 || drive > 1) {
        drive = 0;
    }
    file_system_detach_disk((unsigned int)unit, (unsigned int)drive);
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
const char *grok64_retro_save_directory(void)
{
    return retro_save_directory[0] ? retro_save_directory : "";
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int grok64_disk_attach(int unit, int drive, const char *path)
{
    int fs_bytes;

    grok64_note_attach_diag(NULL);
    if (!path || !path[0]) {
        grok64_note_attach_diag("empty path");
        return -1;
    }
    if (unit < 8 || unit > 11) {
        snprintf(last_disk_attach_diag, sizeof(last_disk_attach_diag), "bad unit %d", unit);
        return -1;
    }
    if (drive < 0 || drive > 1) {
        drive = 0;
    }
    if (event_playback_active()) {
        grok64_note_attach_diag("event_playback_active");
        last_disk_attach_rc = -1;
        return -1;
    }
    fs_bytes = grok64_fs_size_bytes(path);
    if (fs_bytes < 0) {
        snprintf(last_disk_attach_diag, sizeof(last_disk_attach_diag), "fs_stat %s errno=%d", path, -fs_bytes);
        last_disk_attach_rc = -1;
        return -1;
    }
    file_system_detach_disk((unsigned int)unit, (unsigned int)drive);
    last_disk_attach_rc = file_system_attach_disk((unsigned int)unit, (unsigned int)drive, path);
    if (last_disk_attach_rc < 0) {
        snprintf(last_disk_attach_diag, sizeof(last_disk_attach_diag),
                 "file_system_attach_disk unit=%d path=%s fs_bytes=%d", unit, path, fs_bytes);
    } else {
        grok64_disk_route_to_drive((unsigned int)unit);
        grok64_drive_reload_image(unit, drive);
    }
    return last_disk_attach_rc;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int grok64_disk_last_attach_rc(void)
{
    return last_disk_attach_rc;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
const char *grok64_disk_last_attach_diag(void)
{
    return last_disk_attach_diag;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int grok64_fs_stat_bytes(const char *path)
{
    return grok64_fs_size_bytes(path);
}

static int grok64_unit_vdrive_image(int unit, int drive, vdrive_t **vd_out, disk_image_t **img_out)
{
    vdrive_t *vd;
    disk_image_t *img;

    if (unit < 8 || unit > 11) {
        return -EINVAL;
    }
    if (drive < 0 || drive > 1) {
        drive = 0;
    }
    vd = file_system_get_vdrive((unsigned int)unit);
    if (!vd) {
        return -ENODEV;
    }
    img = vdrive_get_image(vd, (unsigned int)drive);
    if (!img) {
        return -ENOENT;
    }
    if (vd_out) {
        *vd_out = vd;
    }
    if (img_out) {
        *img_out = img;
    }
    return 0;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int grok64_drive_image_bytes(int unit, int drive)
{
    disk_image_t *img = NULL;
    off_t sz;

    if (grok64_unit_vdrive_image(unit, drive, NULL, &img) != 0) {
        return -1;
    }
    sz = disk_image_size(img);
    if (sz < 0 || sz > 0x7fffffff) {
        return -1;
    }
    return (int)sz;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int grok64_drive_bam_disk_name(int unit, int drive, char *out, int out_len)
{
    disk_image_t *img = NULL;
    disk_addr_t adr;
    uint8_t sec[256];
    int i, n;

    if (!out || out_len < 2) {
        return -EINVAL;
    }
    if (grok64_unit_vdrive_image(unit, drive, NULL, &img) != 0) {
        return -ENODEV;
    }
    adr.track = 18;
    adr.sector = 0;
    if (disk_image_read_sector(img, sec, &adr) != 0) {
        return -EIO;
    }
    n = 0;
    for (i = 0; i < 16 && n < out_len - 1; i++) {
        uint8_t c = sec[0x90 + i];
        if (c == 0xa0 || c == 0) {
            break;
        }
        out[n++] = (char)c;
    }
    out[n] = '\0';
    return n;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int grok64_drive_last_error_code(int unit)
{
    vdrive_t *vd = file_system_get_vdrive((unsigned int)unit);

    if (!vd) {
        return -1;
    }
    return vd->last_code;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
const char *grok64_drive_error_channel(int unit)
{
    vdrive_t *vd = file_system_get_vdrive((unsigned int)unit);
    bufferinfo_t *p;

    if (!vd) {
        return "";
    }
    p = &vd->buffers[15];
    if (!p->length) {
        return "";
    }
    return (const char *)p->buffer;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int grok64_drive_iec_device(int unit)
{
    char res[32];
    int v = 0;

    if (unit < 8 || unit > 11) {
        return -EINVAL;
    }
    snprintf(res, sizeof(res), "IECDevice%d", unit);
    if (resources_get_int(res, &v) != 0) {
        return -1;
    }
    return v;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int grok64_drive_reload_image(int unit, int drive)
{
    vdrive_t *vdrive;
    disk_image_t *image;
    unsigned int dnr;
    drive_t *drv;

    if (unit < 8 || unit > 11) {
        return -EINVAL;
    }
    if (drive < 0 || drive > 1) {
        drive = 0;
    }
    vdrive = file_system_get_vdrive((unsigned int)unit);
    image = vdrive ? vdrive_get_image(vdrive, (unsigned int)drive) : NULL;
    if (!vdrive || !image) {
        grok64_note_attach_diag("reload: no vdrive/image");
        return -ENODEV;
    }
    if (disk_image_read_image(image) < 0) {
        snprintf(last_disk_attach_diag, sizeof(last_disk_attach_diag),
                 "reload: vdrive disk_image_read_image unit=%d failed", unit);
        return -EIO;
    }
    dnr = (unsigned int)unit - 8;
    if (dnr < NUM_DISK_UNITS && diskunit_context[dnr]) {
        drv = diskunit_context[dnr]->drives[drive];
        if (drv && drv->image && drv->image != image) {
            if (disk_image_read_image(drv->image) < 0) {
                snprintf(last_disk_attach_diag, sizeof(last_disk_attach_diag),
                         "reload: drive disk_image_read_image unit=%d failed", unit);
                return -EIO;
            }
        }
    }
    if (vdrive_bam_read_bam(vdrive) != 0) {
        snprintf(last_disk_attach_diag, sizeof(last_disk_attach_diag),
                 "reload: vdrive_bam_read_bam unit=%d failed", unit);
        return -EIO;
    }
    vdrive->last_code = CBMDOS_IPE_OK;
    return 0;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int grok64_work_disk_refresh(int unit)
{
    char path[GROK64_DISK_PATH_MAX];
    const char *save;

    if (unit < 8 || unit > 11) {
        unit = 8;
    }
    save = retro_save_directory[0] ? retro_save_directory : "/data/saves";
    snprintf(path, sizeof(path), "%s/vice_work.d64", save);
    if (!path[0]) {
        return -1;
    }
    file_system_detach_disk((unsigned int)unit, 0);
    last_disk_attach_rc = file_system_attach_disk((unsigned int)unit, 0, path);
    return last_disk_attach_rc;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int grok64_disk_attach_deferred(int unit, int drive, const char *path)
{
    if (!path || !path[0]) {
        return -1;
    }
    if (unit < 8 || unit > 11) {
        return -1;
    }
    if (drive < 0 || drive > 1) {
        drive = 0;
    }
    pending_disk_unit = unit;
    pending_disk_drive = drive;
    strlcpy(pending_disk_path, path, sizeof(pending_disk_path));
    pending_disk_attach = 1;
    return 0;
}
