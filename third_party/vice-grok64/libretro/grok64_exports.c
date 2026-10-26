#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#endif

#include "libretro.h"
#include "attach.h"
#include "diskimage.h"
#include "fliplist.h"
#include "kbdbuf.h"
#include "machine.h"
#include "maincpu.h"
#include "vdrive/vdrive.h"
#include "vdrive/vdrive-bam.h"
#include "drive/drive.h"
#include "drive/drivecpu.h"
#include "drive/driveimage.h"
#include "machine-drive.h"
#include "machine-bus.h"
#include "iecbus.h"
#include "iecdrive.h"
#include "serial.h"
#include "cbmdos.h"
#include "vice-event.h"
#include "resources.h"
#include "diskimage/fsimage.h"
#include "joyport.h"
#include "mouse.h"
#include "mouse_1351.h"
#include <errno.h>
#include <stdarg.h>
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
int grok64_drive_virtual_device(int unit);
int grok64_drive_unit_true_emulation(int unit);
int grok64_drive_unit_type(int unit);
int grok64_drive_unit_enabled(int unit);
int grok64_rom_loaded(void);
int grok64_drive_serial_device_type(int unit);
int grok64_drive_vdrive_error_is_virtual(int unit);
int grok64_drive_tde_image_bytes(int unit, int drive);
int grok64_drive_gcr_loaded(int unit, int drive);
int grok64_drive_vdrive_image_same(int unit, int drive);
int grok64_drive_sync_tde_image(int unit, int drive);
int grok64_iec_bus_reconcile(int unit);
int grok64_drive_filesystem_device(int unit);
int grok64_drive_cpu_clock(int unit);
int grok64_drive_iec_bus_lines(int unit);
int grok64_drive_set_type(int unit, int type);
static int grok64_unit_vdrive_image(int unit, int drive, vdrive_t **vd_out, disk_image_t **img_out);

extern void process_key(uint8_t disable_keys);

/* Attach rc when the unit's true drive cannot read the image (D81 on a 1541, D64 on a 1581). */
#define GROK64_ATTACH_WRONG_DRIVE (-97)

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
    unsigned int u;

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
    /* KERNAL traps must hit true 1541 DOS, not vdrive fast path (error ch. CBM DOS V2.6). */
    resources_set_int("DriveTrueEmulation", 1);
    snprintf(res, sizeof(res), "Drive%uTrueEmulation", unit);
    resources_set_int(res, 1);
    for (u = 8; u <= 11; u++) {
        snprintf(res, sizeof(res), "VirtualDevice%u", u);
        resources_set_int(res, 0);
    }
    resources_set_int("VirtualDevices", 0);
}

/** KERNAL IEC must not use SERIAL_DEVICE_VIRT traps when TDE + GCR image is live. */
static void grok64_serial_layer_true_iec(unsigned int unit)
{
    char res[32];
    unsigned int u;

    if (unit < 8 || unit > 11) {
        return;
    }
    resources_set_int("VirtualDevices", 0);
    for (u = 8; u <= 11; u++) {
        snprintf(res, sizeof(res), "VirtualDevice%u", u);
        resources_set_int(res, 0);
    }
    snprintf(res, sizeof(res), "FileSystemDevice%u", unit);
    resources_set_int(res, ATTACH_DEVICE_NONE);
    snprintf(res, sizeof(res), "IECDevice%u", unit);
    resources_set_int(res, 0);
    snprintf(res, sizeof(res), "Drive%uTrueEmulation", unit);
    resources_set_int(res, 1);
    resources_set_int("DriveTrueEmulation", 1);
    machine_bus_status_virtualdevices_set(unit, 0);
    machine_bus_status_truedrive_set(unit, 1);
    serial_device_type_set(SERIAL_DEVICE_REAL, unit);
    serial_traps_reset();
}

static void grok64_clear_stale_vdrive_error(unsigned int unit)
{
    vdrive_t *vd;
    int tde_on = 0;

    if (resources_get_int_sprintf("Drive%uTrueEmulation", &tde_on, unit) != 0 || !tde_on) {
        return;
    }
    vd = file_system_get_vdrive(unit);
    if (!vd || !vd->buffers[15].buffer || !vd->buffers[15].length) {
        return;
    }
    if (strstr((const char *)vd->buffers[15].buffer, "VIRTUAL DRIVE") != NULL) {
        vd->buffers[15].length = 0;
        vd->buffers[15].buffer[0] = '\0';
        vd->last_code = 0;
    }
}

/* 1581 (WD1770) and CMD FD (PC8477) read MFM images; they never hold a GCR image. */
static int grok64_drive_type_is_mfm(int dtype)
{
    return dtype == DRIVE_TYPE_1581 || dtype == DRIVE_TYPE_2000 || dtype == DRIVE_TYPE_4000;
}

/* True when the unit's live drive can read the image VICE's vdrive has attached on it. */
static int grok64_unit_image_readable(unsigned int unit, unsigned int drive)
{
    disk_image_t *img = NULL;

    if (unit < 8 || unit > 11 || !diskunit_context[unit - 8]) {
        return 0;
    }
    if (grok64_unit_vdrive_image((int)unit, (int)drive, NULL, &img) != 0 || !img) {
        return 0;
    }
    return drive_check_image_format(img->type, unit - 8) == 0;
}

static void grok64_disk_coerce_unit_1541(unsigned int unit)
{
    int dtype = 0;
    unsigned int dnr;

    if (unit < 8 || unit > 11) {
        return;
    }
    if (resources_get_int_sprintf("Drive%uType", &dtype, unit) != 0) {
        return;
    }
    if (dtype == DRIVE_TYPE_1541) {
        return;
    }
    if (dtype != DRIVE_TYPE_NONE && dtype != DRIVE_TYPE_1541II) {
        return;
    }
    resources_set_int_sprintf("Drive%uType", DRIVE_TYPE_1541, unit);
    dnr = unit - 8;
    if (diskunit_context[dnr] && diskunit_context[dnr]->type != DRIVE_TYPE_NONE) {
        drive_set_disk_drive_type(DRIVE_TYPE_1541, diskunit_context[dnr]);
    }
}

static void grok64_disk_sync_true_drive(unsigned int unit)
{
    unsigned int dnr;
    diskunit_context_t *ctx;
    int dtype = 0;
    int tde_on = 0;

    if (unit < 8 || unit > 11) {
        return;
    }
    grok64_disk_route_to_drive(unit);
    if (resources_get_int_sprintf("Drive%uType", &dtype, unit) == 0 && dtype == DRIVE_TYPE_NONE) {
        resources_set_int_sprintf("Drive%uType", DRIVE_TYPE_1541, unit);
    }
    if (!rom_loaded) {
        grok64_note_attach_diag("sync-tde: rom_loaded=0");
        return;
    }
    resources_get_int_sprintf("Drive%uTrueEmulation", &tde_on, unit);
    if (!tde_on) {
        resources_set_int_sprintf("Drive%uTrueEmulation", 1, unit);
        resources_set_int("DriveTrueEmulation", 1);
    }
    dnr = unit - 8;
    ctx = diskunit_context[dnr];
    if (!ctx || ctx->type == DRIVE_TYPE_NONE) {
        grok64_note_attach_diag("sync-tde: no drive unit");
        return;
    }
    vdrive_flush(unit);
    if (drive_enable(ctx) < 0) {
        snprintf(last_disk_attach_diag, sizeof(last_disk_attach_diag),
                 "sync-tde: drive_enable unit=%u failed", unit);
    }
    grok64_serial_layer_true_iec(unit);
    grok64_clear_stale_vdrive_error(unit);
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
    process_key(0);
}

/* Emulated C64 CPU cycles; drops back to a few cycles on machine reset. */
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
double grok64_main_cpu_clock(void)
{
    return (double)maincpu_clk;
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
    grok64_disk_coerce_unit_1541((unsigned int)unit);
    grok64_disk_route_to_drive((unsigned int)unit);
    fs_bytes = grok64_fs_size_bytes(path);
    if (fs_bytes < 0) {
        snprintf(last_disk_attach_diag, sizeof(last_disk_attach_diag), "fs_stat %s errno=%d", path, -fs_bytes);
        last_disk_attach_rc = fs_bytes;
        return fs_bytes;
    }
    file_system_detach_disk((unsigned int)unit, (unsigned int)drive);
    last_disk_attach_rc = file_system_attach_disk((unsigned int)unit, (unsigned int)drive, path);
    if (last_disk_attach_rc < 0) {
        snprintf(last_disk_attach_diag, sizeof(last_disk_attach_diag),
                 "file_system_attach_disk unit=%d path=%s fs_bytes=%d", unit, path, fs_bytes);
    } else {
        int sync_rc;

        /* vdrive opens any image, so the attach succeeds even when the drive CPU cannot read it. */
        if (!grok64_unit_image_readable((unsigned int)unit, (unsigned int)drive)) {
            disk_image_t *img = NULL;
            int img_type = -1;

            if (grok64_unit_vdrive_image(unit, drive, NULL, &img) == 0 && img) {
                img_type = (int)img->type;
            }
            snprintf(last_disk_attach_diag, sizeof(last_disk_attach_diag),
                     "wrong drive: unit=%d drive type %u cannot read image type %d (%s)", unit,
                     diskunit_context[unit - 8] ? diskunit_context[unit - 8]->type : 0u, img_type, path);
            file_system_detach_disk((unsigned int)unit, (unsigned int)drive);
            last_disk_attach_rc = GROK64_ATTACH_WRONG_DRIVE;
            return last_disk_attach_rc;
        }
        grok64_disk_sync_true_drive((unsigned int)unit);
        sync_rc = grok64_drive_reload_image(unit, drive);
        if (sync_rc < 0) {
            last_disk_attach_rc = sync_rc;
            return sync_rc;
        }
        /* iec_bus_reconcile: JS calls once after attach (not here — nested reconcile stack overflow). */
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
    /* 1581 header: track 40 sector 0, name at $04; 1541/1571 BAM: track 18 sector 0, name at $90. */
    adr.track = img->type == DISK_IMAGE_TYPE_D81 ? 40 : 18;
    adr.sector = 0;
    if (disk_image_read_sector(img, sec, &adr) != 0) {
        return -EIO;
    }
    n = 0;
    for (i = 0; i < 16 && n < out_len - 1; i++) {
        uint8_t c = sec[(img->type == DISK_IMAGE_TYPE_D81 ? 0x04 : 0x90) + i];
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
int grok64_drive_virtual_device(int unit)
{
    char res[32];
    int v = 0;

    if (unit < 8 || unit > 11) {
        return -EINVAL;
    }
    snprintf(res, sizeof(res), "VirtualDevice%d", unit);
    if (resources_get_int(res, &v) != 0) {
        return -1;
    }
    return v;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int grok64_drive_unit_true_emulation(int unit)
{
    char res[32];
    int v = 0;

    if (unit < 8 || unit > 11) {
        return -EINVAL;
    }
    snprintf(res, sizeof(res), "Drive%dTrueEmulation", unit);
    if (resources_get_int(res, &v) != 0) {
        return -1;
    }
    return v;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int grok64_drive_unit_type(int unit)
{
    unsigned int dnr;
    int dtype = 0;

    if (unit < 8 || unit > 11) {
        return -EINVAL;
    }
    if (resources_get_int_sprintf("Drive%uType", &dtype, unit) == 0 && dtype != DRIVE_TYPE_NONE) {
        return dtype;
    }
    dnr = (unsigned int)unit - 8;
    if (!diskunit_context[dnr]) {
        return -ENODEV;
    }
    return (int)diskunit_context[dnr]->type;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int grok64_drive_unit_enabled(int unit)
{
    unsigned int dnr;

    if (unit < 8 || unit > 11) {
        return -EINVAL;
    }
    dnr = (unsigned int)unit - 8;
    if (!diskunit_context[dnr]) {
        return -ENODEV;
    }
    return diskunit_context[dnr]->enable ? 1 : 0;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int grok64_rom_loaded(void)
{
    return rom_loaded ? 1 : 0;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int grok64_drive_serial_device_type(int unit)
{
    if (unit < 0 || unit >= SERIAL_MAXDEVICES) {
        return -EINVAL;
    }
    return (int)serial_device_type_get((unsigned int)unit);
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int grok64_drive_vdrive_error_is_virtual(int unit)
{
    const char *ch = grok64_drive_error_channel(unit);

    if (!ch || !ch[0]) {
        return 0;
    }
    return strstr(ch, "VIRTUAL DRIVE") != NULL ? 1 : 0;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
static drive_t *grok64_unit_drive(unsigned int unit, unsigned int drive)
{
    unsigned int dnr;

    if (unit < 8 || unit > 11) {
        return NULL;
    }
    dnr = unit - 8;
    if (dnr >= NUM_DISK_UNITS || !diskunit_context[dnr]) {
        return NULL;
    }
    return diskunit_context[dnr]->drives[drive];
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int grok64_drive_filesystem_device(int unit)
{
    char res[32];
    int v = 0;

    if (unit < 8 || unit > 11) {
        return -EINVAL;
    }
    snprintf(res, sizeof(res), "FileSystemDevice%u", unit);
    if (resources_get_int(res, &v) != 0) {
        return -1;
    }
    return v;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int grok64_drive_cpu_clock(int unit)
{
    unsigned int dnr;

    if (unit < 8 || unit > 11) {
        return -EINVAL;
    }
    dnr = (unsigned int)unit - 8;
    if (dnr >= NUM_DISK_UNITS) {
        return -ENODEV;
    }
    return (int)(diskunit_clk[dnr] & 0x7fffffff);
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int grok64_drive_iec_bus_lines(int unit)
{
    unsigned int idx;

    if (unit < 8 || unit > 11) {
        return -EINVAL;
    }
    idx = (unsigned int)unit;
    if (idx >= IECBUS_NUM) {
        return -ENODEV;
    }
    /* low 8: drv_data[unit]; high 8: iecbus.cpu_bus (bit 0x10 ATN out released; 0x80 DATA-IN) */
    return ((int)iecbus.drv_data[idx] & 0xff) | (((int)iecbus.cpu_bus & 0xff) << 8);
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
static void grok64_vice_apply_safe_floppy_profile_unit(unsigned int unit)
{
    char res[48];
    unsigned int u;
    int v = 0;

    resources_set_int("VirtualDevices", 0);
    resources_set_int("DriveTrueEmulation", 1);
    resources_set_int("DriveSoundEmulation", 0);
    resources_set_int("DriveSoundEmulationVolume", 0);
    for (u = 8; u <= 11; u++) {
        snprintf(res, sizeof(res), "Drive%uParallelCable", u);
        resources_set_int(res, 0);
        snprintf(res, sizeof(res), "Drive%uIdleMethod", u);
        resources_set_int(res, 0);
        snprintf(res, sizeof(res), "Drive%uExtendImagePolicy", u);
        resources_set_int(res, 0);
        snprintf(res, sizeof(res), "FileSystemDevice%u", u);
        resources_set_int(res, ATTACH_DEVICE_NONE);
        snprintf(res, sizeof(res), "IECDevice%u", u);
        resources_set_int(res, 0);
        snprintf(res, sizeof(res), "VirtualDevice%u", u);
        resources_set_int(res, 0);
        snprintf(res, sizeof(res), "Drive%uTrueEmulation", u);
        resources_set_int(res, 1);
        snprintf(res, sizeof(res), "Drive%uRAM2000", u);
        resources_set_int(res, 0);
        snprintf(res, sizeof(res), "Drive%uRAM4000", u);
        resources_set_int(res, 0);
        snprintf(res, sizeof(res), "Drive%uRAM6000", u);
        resources_set_int(res, 0);
        snprintf(res, sizeof(res), "Drive%uRAM8000", u);
        resources_set_int(res, 0);
        snprintf(res, sizeof(res), "Drive%uRAMA000", u);
        resources_set_int(res, 0);
    }
    /* Writing DriveNType, even unchanged, detaches the disk and resets the drive CPU.
       A 1581 / CMD FD holding an image it reads is the configured drive, not a stale one. */
    snprintf(res, sizeof(res), "Drive%uType", unit);
    if (resources_get_int(res, &v) != 0 || v != DRIVE_TYPE_1541) {
        if (!(grok64_drive_type_is_mfm(v) && grok64_unit_image_readable(unit, 0))) {
            resources_set_int(res, DRIVE_TYPE_1541);
        }
    }
}

/* Sets DriveNType only when it differs: every write detaches the unit's disks and resets its CPU. */
#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int grok64_drive_set_type(int unit, int type)
{
    unsigned int dnr;
    int cur = -1;

    if (unit < 8 || unit > 11) {
        return -EINVAL;
    }
    switch (type) {
        case DRIVE_TYPE_NONE:
        case DRIVE_TYPE_1541:
        case DRIVE_TYPE_1541II:
        case DRIVE_TYPE_1570:
        case DRIVE_TYPE_1571:
        case DRIVE_TYPE_1581:
        case DRIVE_TYPE_2000:
        case DRIVE_TYPE_4000:
        case DRIVE_TYPE_CMDHD:
            break;
        default:
            return -EINVAL;
    }
    dnr = (unsigned int)unit - 8;
    if (!diskunit_context[dnr]) {
        return -ENODEV;
    }
    if (resources_get_int_sprintf("Drive%dType", &cur, unit) == 0 && cur == type
        && (int)diskunit_context[dnr]->type == type) {
        return type;
    }
    if (type != DRIVE_TYPE_NONE && machine_drive_rom_check_loaded((unsigned int)type) < 0) {
        snprintf(last_disk_attach_diag, sizeof(last_disk_attach_diag),
                 "set-type: drive ROM for type %d not loaded (unit %d)", type, unit);
        return -ENOENT;
    }
    if (resources_set_int_sprintf("Drive%dType", type, unit) != 0
        || (int)diskunit_context[dnr]->type != type) {
        snprintf(last_disk_attach_diag, sizeof(last_disk_attach_diag),
                 "set-type: Drive%dType=%d rejected (live type %u)", unit, type, diskunit_context[dnr]->type);
        return -EIO;
    }
    return type;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int grok64_vice_apply_safe_floppy_profile(int unit)
{
    if (unit < 8 || unit > 11) {
        return -EINVAL;
    }
    grok64_vice_apply_safe_floppy_profile_unit((unsigned int)unit);
    iec_update_ports();
    return 0;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
static char last_vice_drive_resource_json[8192];

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
const char *grok64_vice_drive_resource_snapshot(void)
{
    char res[48];
    unsigned int u;
    int v;
    int pos = 0;
    int out_len = (int)sizeof(last_vice_drive_resource_json);
    char *out = last_vice_drive_resource_json;

    last_vice_drive_resource_json[0] = '\0';
    pos += snprintf(out + pos, out_len - pos, "{");
    for (u = 8; u <= 11 && pos < out_len - 64; u++) {
        if (u > 8) {
            pos += snprintf(out + pos, out_len - pos, ",");
        }
        pos += snprintf(out + pos, out_len - pos, "\"u%u\":{", u);
        snprintf(res, sizeof(res), "Drive%uType", u);
        if (resources_get_int(res, &v) == 0) {
            pos += snprintf(out + pos, out_len - pos, "\"type\":%d,", v);
        }
        snprintf(res, sizeof(res), "Drive%uTrueEmulation", u);
        if (resources_get_int(res, &v) == 0) {
            pos += snprintf(out + pos, out_len - pos, "\"tde\":%d,", v);
        }
        snprintf(res, sizeof(res), "FileSystemDevice%u", u);
        if (resources_get_int(res, &v) == 0) {
            pos += snprintf(out + pos, out_len - pos, "\"fsDev\":%d,", v);
        }
        snprintf(res, sizeof(res), "IECDevice%u", u);
        if (resources_get_int(res, &v) == 0) {
            pos += snprintf(out + pos, out_len - pos, "\"iecDev\":%d,", v);
        }
        snprintf(res, sizeof(res), "VirtualDevice%u", u);
        if (resources_get_int(res, &v) == 0) {
            pos += snprintf(out + pos, out_len - pos, "\"virtDev\":%d,", v);
        }
        snprintf(res, sizeof(res), "Drive%uIdleMethod", u);
        if (resources_get_int(res, &v) == 0) {
            pos += snprintf(out + pos, out_len - pos, "\"idle\":%d,", v);
        }
        snprintf(res, sizeof(res), "Drive%uParallelCable", u);
        if (resources_get_int(res, &v) == 0) {
            pos += snprintf(out + pos, out_len - pos, "\"parallel\":%d,", v);
        }
        snprintf(res, sizeof(res), "Drive%uExtendImagePolicy", u);
        if (resources_get_int(res, &v) == 0) {
            pos += snprintf(out + pos, out_len - pos, "\"extend\":%d", v);
        }
        pos += snprintf(out + pos, out_len - pos, "}");
    }
    if (resources_get_int("VirtualDevices", &v) == 0) {
        pos += snprintf(out + pos, out_len - pos, ",\"VirtualDevices\":%d", v);
    }
    if (resources_get_int("DriveSoundEmulation", &v) == 0) {
        pos += snprintf(out + pos, out_len - pos, ",\"DriveSoundEmulation\":%d", v);
    }
    pos += snprintf(out + pos, out_len - pos, ",\"iecCpuBus\":%d,\"iecDrv8\":%d",
                    (int)iecbus.cpu_bus & 0xff, (int)iecbus.drv_data[8] & 0xff);
    pos += snprintf(out + pos, out_len - pos, "}");
    return last_vice_drive_resource_json;
}

int grok64_iec_bus_reconcile(int unit)
{
    unsigned int dnr;
    diskunit_context_t *ctx;
    int rc;

    if (unit < 8 || unit > 11) {
        return -EINVAL;
    }
    grok64_vice_apply_safe_floppy_profile_unit((unsigned int)unit);
    grok64_disk_route_to_drive((unsigned int)unit);
    grok64_serial_layer_true_iec((unsigned int)unit);
    dnr = (unsigned int)unit - 8;
    ctx = diskunit_context[dnr];
    if (!ctx || ctx->type == DRIVE_TYPE_NONE) {
        snprintf(last_disk_attach_diag, sizeof(last_disk_attach_diag),
                 "iec-reconcile: no drive unit=%d", unit);
        return -ENODEV;
    }
    if (drive_enable(ctx) < 0) {
        snprintf(last_disk_attach_diag, sizeof(last_disk_attach_diag),
                 "iec-reconcile: drive_enable unit=%d failed", unit);
        return -EIO;
    }
    rc = grok64_drive_sync_tde_image(unit, 0);
    if (rc < 0) {
        return rc;
    }
    grok64_clear_stale_vdrive_error((unsigned int)unit);
    iec_update_ports();
    return 0;
}

int grok64_drive_sync_tde_image(int unit, int drive)
{
    vdrive_t *vdrive;
    disk_image_t *image;
    drive_t *drv;
    int tde_on = 0;

    if (unit < 8 || unit > 11) {
        return -EINVAL;
    }
    if (drive < 0 || drive > 1) {
        drive = 0;
    }
    grok64_disk_route_to_drive((unsigned int)unit);
    if (resources_get_int_sprintf("Drive%uTrueEmulation", &tde_on, unit) != 0 || !tde_on) {
        return 0;
    }
    grok64_disk_sync_true_drive((unsigned int)unit);
    vdrive = file_system_get_vdrive((unsigned int)unit);
    image = vdrive ? vdrive_get_image(vdrive, (unsigned int)drive) : NULL;
    if (!image) {
        grok64_note_attach_diag("sync-tde: no vdrive image");
        return -ENOENT;
    }
    if (!diskunit_context[unit - 8]) {
        grok64_note_attach_diag("sync-tde: no drive unit");
        return -ENODEV;
    }
    if (drive_check_image_format(image->type, (unsigned int)unit - 8) < 0) {
        snprintf(last_disk_attach_diag, sizeof(last_disk_attach_diag),
                 "sync-tde: unit=%d drive type %u cannot read image type %u", unit,
                 diskunit_context[unit - 8]->type, image->type);
        return GROK64_ATTACH_WRONG_DRIVE;
    }
    /* 1581 / CMD FD: attach_disk_image handed this image to the WD1770 / PC8477 controller. */
    if (grok64_drive_type_is_mfm((int)diskunit_context[unit - 8]->type)) {
        return 0;
    }
    drv = grok64_unit_drive((unsigned int)unit, (unsigned int)drive);
    if (drv && drv->image == image && drv->GCR_image_loaded) {
        if (disk_image_read_image(image) < 0) {
            snprintf(last_disk_attach_diag, sizeof(last_disk_attach_diag),
                     "sync-tde: disk_image_read_image unit=%d failed", unit);
            return -EIO;
        }
        return 0;
    }
    if (drv && drv->image && drv->image != image) {
        drive_image_detach(drv->image, (unsigned int)unit, (unsigned int)drive);
    }
    if (drive_image_attach(image, (unsigned int)unit, (unsigned int)drive) < 0) {
        snprintf(last_disk_attach_diag, sizeof(last_disk_attach_diag),
                 "sync-tde: drive_image_attach unit=%d failed", unit);
        return -EIO;
    }
    drv = grok64_unit_drive((unsigned int)unit, (unsigned int)drive);
    if (!drv || !drv->GCR_image_loaded) {
        snprintf(last_disk_attach_diag, sizeof(last_disk_attach_diag),
                 "sync-tde: GCR not loaded unit=%d", unit);
        return -EIO;
    }
    return 0;
}

int grok64_drive_tde_image_bytes(int unit, int drive)
{
    unsigned int dnr;
    drive_t *drv;
    off_t sz;

    if (unit < 8 || unit > 11) {
        return -EINVAL;
    }
    if (drive < 0 || drive > 1) {
        drive = 0;
    }
    dnr = (unsigned int)unit - 8;
    if (dnr >= NUM_DISK_UNITS || !diskunit_context[dnr]) {
        return -ENODEV;
    }
    drv = diskunit_context[dnr]->drives[drive];
    if (!drv || !drv->image) {
        return -ENOENT;
    }
    sz = disk_image_size(drv->image);
    if (sz < 0 || sz > 0x7fffffff) {
        return -1;
    }
    return (int)sz;
}

int grok64_drive_gcr_loaded(int unit, int drive)
{
    unsigned int dnr;
    drive_t *drv;

    if (unit < 8 || unit > 11) {
        return -EINVAL;
    }
    if (drive < 0 || drive > 1) {
        drive = 0;
    }
    dnr = (unsigned int)unit - 8;
    if (dnr >= NUM_DISK_UNITS || !diskunit_context[dnr]) {
        return 0;
    }
    drv = diskunit_context[dnr]->drives[drive];
    if (!drv || !drv->image) {
        return 0;
    }
    return drv->GCR_image_loaded ? 1 : 0;
}

int grok64_drive_vdrive_image_same(int unit, int drive)
{
    vdrive_t *vdrive;
    disk_image_t *vimg;
    unsigned int dnr;
    drive_t *drv;

    if (unit < 8 || unit > 11) {
        return -EINVAL;
    }
    if (drive < 0 || drive > 1) {
        drive = 0;
    }
    vdrive = file_system_get_vdrive((unsigned int)unit);
    vimg = vdrive ? vdrive_get_image(vdrive, (unsigned int)drive) : NULL;
    dnr = (unsigned int)unit - 8;
    if (!vimg || dnr >= NUM_DISK_UNITS || !diskunit_context[dnr]) {
        return 0;
    }
    drv = diskunit_context[dnr]->drives[drive];
    if (!drv || !drv->image) {
        return 0;
    }
    return drv->image == vimg ? 1 : 0;
}

int grok64_drive_reload_image(int unit, int drive)
{
    vdrive_t *vdrive;
    disk_image_t *image;
    int rc;

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
    /* Only an image the true drive holds has a GCR buffer; D81/DHD have none to rebuild. */
    if (image->gcr != NULL && disk_image_read_image(image) < 0) {
        snprintf(last_disk_attach_diag, sizeof(last_disk_attach_diag),
                 "reload: vdrive disk_image_read_image unit=%d failed", unit);
        return -EIO;
    }
    rc = grok64_drive_sync_tde_image(unit, drive);
    if (rc < 0) {
        return rc;
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

static int grok64_appendf(char *out, int out_len, int pos, const char *fmt, ...)
{
    va_list ap;
    int n;

    if (pos < 0 || pos >= out_len - 1) {
        return pos;
    }
    va_start(ap, fmt);
    n = vsnprintf(out + pos, (size_t)(out_len - pos), fmt, ap);
    va_end(ap);
    if (n < 0) {
        return pos;
    }
    return (pos + n >= out_len) ? out_len - 1 : pos + n;
}

static int grok64_error_code_digit(int code)
{
    return code > 15 ? 15 : code;
}

static int grok64_hex_bytes(char *out, int out_len, int pos, const uint8_t *p, int n)
{
    int i;

    for (i = 0; i < n; i++) {
        pos = grok64_appendf(out, out_len, pos, "%02x", p[i]);
    }
    return pos;
}

/* 1541 DOS state read straight from drive RAM (no bus traffic): job queue $00-$05 with
   its track/sector table $06-$11, master disk ID $12/$13, last header read $16-$1A
   (ID, ID, track, sector, checksum), command buffer $0200 (the name the drive received)
   and the error channel text at $02D5. */
static int grok64_dos1541_json(int unit, char *out, int out_len, int pos)
{
    const diskunit_context_t *du;
    const uint8_t *ram;
    unsigned int dnr = (unsigned int)unit - 8;
    int i;

    du = (dnr < NUM_DISK_UNITS) ? diskunit_context[dnr] : NULL;
    if (!du || !du->enable
        || (du->type != DRIVE_TYPE_1540 && du->type != DRIVE_TYPE_1541
            && du->type != DRIVE_TYPE_1541II)) {
        return grok64_appendf(out, out_len, pos, "null");
    }
    ram = du->drive_ram;
    pos = grok64_appendf(out, out_len, pos, "{\"jobsHex\":\"");
    pos = grok64_hex_bytes(out, out_len, pos, ram + 0x00, 6);
    pos = grok64_appendf(out, out_len, pos, "\",\"jobTsHex\":\"");
    pos = grok64_hex_bytes(out, out_len, pos, ram + 0x06, 12);
    pos = grok64_appendf(out, out_len, pos, "\",\"diskIdHex\":\"");
    pos = grok64_hex_bytes(out, out_len, pos, ram + 0x12, 2);
    pos = grok64_appendf(out, out_len, pos, "\",\"lastHeaderHex\":\"");
    pos = grok64_hex_bytes(out, out_len, pos, ram + 0x16, 5);
    pos = grok64_appendf(out, out_len, pos, "\",\"cmdHex\":\"");
    pos = grok64_hex_bytes(out, out_len, pos, ram + 0x0200, 16);
    pos = grok64_appendf(out, out_len, pos, "\",\"errorChannel\":\"");
    for (i = 0; i < 36 && ram[0x02d5 + i] != 0x0d; i++) {
        uint8_t c = ram[0x02d5 + i];
        pos = grok64_appendf(out, out_len, pos, "%c",
                             (c >= 0x20 && c < 0x7f && c != '"' && c != '\\') ? c : '.');
    }
    return grok64_appendf(out, out_len, pos, "\"}");
}

/* Error-info table of the image as VICE holds it: code histogram, track 18 codes
   (one hex digit per sector) and the sectors flagged with an error (code above 1). */
static int grok64_error_info_json(disk_image_t *img, char *out, int out_len, int pos)
{
    fsimage_t *fs;
    const uint8_t *map;
    int hist[256];
    int entries, i, idx, flagged = 0, listed = 0, first = 1;
    unsigned int t, s, spt;

    fs = (img && img->device == DISK_IMAGE_DEVICE_FS) ? img->media.fsimage : NULL;
    if (!fs || !fs->error_info.map || fs->error_info.len <= 0) {
        return grok64_appendf(out, out_len, pos, "{\"present\":false}");
    }
    map = fs->error_info.map;
    entries = fs->error_info.len;
    memset(hist, 0, sizeof(hist));
    for (i = 0; i < entries; i++) {
        hist[map[i]]++;
    }
    pos = grok64_appendf(out, out_len, pos, "{\"present\":true,\"entries\":%d,\"codes\":{", entries);
    for (i = 0; i < 256; i++) {
        if (hist[i]) {
            pos = grok64_appendf(out, out_len, pos, "%s\"%d\":%d", first ? "" : ",", i, hist[i]);
            first = 0;
        }
    }
    pos = grok64_appendf(out, out_len, pos, "},\"track18\":\"");
    for (s = 0; s < 19; s++) {
        idx = disk_image_check_sector(img, 18, s);
        pos = grok64_appendf(out, out_len, pos, "%x",
                             (idx >= 0 && idx < entries) ? grok64_error_code_digit(map[idx]) : 0);
    }
    pos = grok64_appendf(out, out_len, pos, "\",\"flagged\":[");
    for (t = 1; t <= img->tracks; t++) {
        spt = disk_image_sector_per_track(img->type, t);
        for (s = 0; s < spt; s++) {
            idx = disk_image_check_sector(img, t, s);
            if (idx < 0 || idx >= entries || map[idx] <= CBMDOS_FDC_ERR_OK) {
                continue;
            }
            flagged++;
            if (listed < 48) {
                pos = grok64_appendf(out, out_len, pos, "%s[%u,%u,%d]", listed ? "," : "", t, s, map[idx]);
                listed++;
            }
        }
    }
    pos = grok64_appendf(out, out_len, pos, "],\"flaggedCount\":%d}", flagged);
    return pos;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
static char last_load_dollar_diag_json[8192];

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
const char *grok64_load_dollar_diag_capture(int unit)
{
    uint8_t buf[64];
    uint8_t t18[256];
    uint8_t t18s1[256];
    char bam_name[20];
    int i;
    int pos = 0;
    int out_len = (int)sizeof(last_load_dollar_diag_json);
    char *out = last_load_dollar_diag_json;
    vdrive_t *vd;
    unsigned int dnr;
    drive_t *drv;
    disk_image_t *img;
    disk_addr_t adr;
    int half = -1;
    int gcr = 0;
    int img_bytes = 0;
    int vdsame = 0;
    int iec_lines = 0;
    int serial = 0;
    int vd_code = 0;

    if (unit < 8 || unit > 11) {
        unit = 8;
    }
    last_load_dollar_diag_json[0] = '\0';
    pos += snprintf(out + pos, out_len - pos, "{\"unit\":%d", unit);

    for (i = 0; i < 48; i++) {
        buf[i] = grok64_c64_read((uint16_t)(0x0200 + i));
    }
    pos += snprintf(out + pos, out_len - pos, ",\"c64Input0200Hex\":\"");
    for (i = 0; i < 48 && pos < out_len - 4; i++) {
        pos += snprintf(out + pos, out_len - pos, "%02x", buf[i]);
    }
    pos += snprintf(out + pos, out_len - pos, "\"");

    pos += snprintf(out + pos, out_len - pos, ",\"kernalIecNameC3Hex\":\"");
    for (i = 0; i < 24 && pos < out_len - 4; i++) {
        pos += snprintf(out + pos, out_len - pos, "%02x", grok64_c64_read((uint16_t)(0x00c3 + i)));
    }
    pos += snprintf(out + pos, out_len - pos, "\"");

    {
        uint16_t fnam_ptr;
        uint8_t fnam_len;
        int j;

        fnam_len = grok64_c64_read(0x00b7);
        fnam_ptr = (uint16_t)grok64_c64_read(0x00bb) | ((uint16_t)grok64_c64_read(0x00bc) << 8);
        pos += snprintf(out + pos, out_len - pos,
                        ",\"c64FnamLen\":%d,\"c64FnamPtr\":%u,\"c64FnambHex\":\"",
                        (int)fnam_len, (unsigned)fnam_ptr);
        for (i = 0; i < 16 && pos < out_len - 4; i++) {
            pos += snprintf(out + pos, out_len - pos, "%02x", grok64_c64_read((uint16_t)(0x00bb + i)));
        }
        pos += snprintf(out + pos, out_len - pos, "\",\"c64FnamAtPtrHex\":\"");
        for (j = 0; j < 24 && pos < out_len - 4; j++) {
            pos += snprintf(out + pos, out_len - pos, "%02x", grok64_c64_read(fnam_ptr + (uint16_t)j));
        }
        pos += snprintf(out + pos, out_len - pos, "\"");
    }

    vd = file_system_get_vdrive((unsigned int)unit);
    if (vd) {
        vd_code = vd->last_code;
    }
    serial = grok64_drive_serial_device_type(unit);
    iec_lines = grok64_drive_iec_bus_lines(unit);
    gcr = grok64_drive_gcr_loaded(unit, 0);
    img_bytes = grok64_drive_tde_image_bytes(unit, 0);
    vdsame = grok64_drive_vdrive_image_same(unit, 0);

    dnr = (unsigned int)unit - 8;
    if (dnr < NUM_DISK_UNITS && diskunit_context[dnr]) {
        drv = diskunit_context[dnr]->drives[0];
        if (drv) {
            half = drv->current_half_track;
            img = drv->image;
        } else {
            img = NULL;
        }
    } else {
        drv = NULL;
        img = NULL;
    }

    bam_name[0] = '\0';
    memset(t18, 0, sizeof(t18));
    memset(t18s1, 0, sizeof(t18s1));
    if (grok64_unit_vdrive_image(unit, 0, NULL, &img) == 0 && img) {
        adr.track = 18;
        adr.sector = 0;
        (void)disk_image_read_sector(img, t18, &adr);
        adr.sector = 1;
        (void)disk_image_read_sector(img, t18s1, &adr);
        (void)grok64_drive_bam_disk_name(unit, 0, bam_name, (int)sizeof(bam_name));
    }

    pos += snprintf(out + pos, out_len - pos, ",\"vdriveLastCode\":%d,\"vdriveErrorChHex\":\"", vd_code);
    if (vd && vd->buffers[15].buffer && vd->buffers[15].length) {
        int n = (int)vd->buffers[15].length;
        if (n > 48) {
            n = 48;
        }
        for (i = 0; i < n && pos < out_len - 4; i++) {
            pos += snprintf(out + pos, out_len - pos, "%02x", vd->buffers[15].buffer[i]);
        }
    }
    pos += snprintf(out + pos, out_len - pos, "\"");

    pos += snprintf(out + pos, out_len - pos,
                    ",\"serialDeviceType\":%d,\"iecBusLines\":%d,"
                    "\"iecCpuBus\":%d,\"iecDrvData\":%d,"
                    "\"iecAtnOutReleased\":%s,\"iecAtnAsserted\":%s,"
                    "\"tdeHalfTrack\":%d,\"tdeGcrLoaded\":%d,\"tdeImageBytes\":%d,"
                    "\"vdriveImageSameAsTde\":%d,\"imgBamDiskName\":\"",
                    serial, iec_lines, (iec_lines >> 8) & 0xff, iec_lines & 0xff,
                    ((iec_lines >> 8) & 0x10) ? "true" : "false",
                    ((iec_lines >> 8) & 0x10) ? "false" : "true",
                    half, gcr, img_bytes, vdsame);
    for (i = 0; bam_name[i] && pos < out_len - 4; i++) {
        char c = bam_name[i];
        if (c == '"' || c == '\\') {
            out[pos++] = '\\';
        }
        out[pos++] = c;
    }
    pos += snprintf(out + pos, out_len - pos, "\",\"imgBamIdHex\":\"%02x%02x", t18[0xa2], t18[0xa3]);
    pos += snprintf(out + pos, out_len - pos, "\",\"imgTrack18Sector0Hex\":\"");
    for (i = 0; i < 32 && pos < out_len - 4; i++) {
        pos += snprintf(out + pos, out_len - pos, "%02x", t18[i]);
    }
    pos += snprintf(out + pos, out_len - pos, "\",\"imgTrack18Sector1Hex\":\"");
    for (i = 0; i < 64 && pos < out_len - 4; i++) {
        pos += snprintf(out + pos, out_len - pos, "%02x", t18s1[i]);
    }
    pos = grok64_appendf(out, out_len, pos, "\",\"errorInfo\":");
    pos = grok64_error_info_json(img, out, out_len, pos);
    pos = grok64_appendf(out, out_len, pos, ",\"dos1541\":");
    pos = grok64_dos1541_json(unit, out, out_len, pos);
    pos = grok64_appendf(out, out_len, pos, "}");
    return last_load_dollar_diag_json;
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

/* VICE REUfilename + REUsize + REU enable — same path as -reuimage at load_game. */
static int grok64_reu_legal_kb(int kb)
{
    static const int legal[] = { 128, 256, 512, 1024, 2048, 4096, 8192, 16384 };
    int i;

    if (kb <= 0) {
        return 0;
    }
    for (i = 0; i < (int)(sizeof(legal) / sizeof(legal[0])); i++) {
        if (legal[i] >= kb) {
            return legal[i];
        }
    }
    return 16384;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int grok64_reu_attach(const char *path, int size_kb)
{
    int bytes;
    int kb = size_kb;

    if (path && path[0]) {
        bytes = grok64_fs_size_bytes(path);
        if (bytes < 0) {
            return bytes;
        }
        if (kb <= 0) {
            kb = bytes / 1024;
        }
    }
    kb = grok64_reu_legal_kb(kb);
    if (kb > 0 && resources_set_int("REUsize", kb) < 0) {
        return -1;
    }
    if (path && path[0] && resources_set_string("REUfilename", path) < 0) {
        return -2;
    }
    if (resources_set_int("REU", 1) < 0) {
        return -3;
    }
    return 0;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int grok64_reu_size_kb(void)
{
    int kb = 0;

    if (resources_get_int("REUsize", &kb) != 0) {
        return -1;
    }
    return kb;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
void grok64_mouse_move(int dx, int dy)
{
    mouse_move((float)dx, (float)dy);
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
void grok64_mouse_buttons(int left, int right)
{
    mouse_1351_button_left(left ? 1 : 0);
    mouse_1351_button_right(right ? 1 : 0);
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int grok64_mouse_plug(int port, int on)
{
    const char *this_res;
    const char *other_res;

    if (port == 1) {
        this_res = "JoyPort1Device";
        other_res = "JoyPort2Device";
    } else if (port == 2) {
        this_res = "JoyPort2Device";
        other_res = "JoyPort1Device";
    } else {
        return -2;
    }

    if (resources_set_int("Mouse", on ? 1 : 0) < 0) {
        return -1;
    }
    if (resources_set_int(this_res, on ? JOYPORT_ID_MOUSE_1351 : JOYPORT_ID_JOYSTICK) < 0) {
        return -3;
    }
    if (on && resources_set_int(other_res, JOYPORT_ID_JOYSTICK) < 0) {
        return -4;
    }
    return 0;
}
