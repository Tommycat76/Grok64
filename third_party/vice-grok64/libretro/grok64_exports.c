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
#include <stdint.h>
#include <stdio.h>
#include <string.h>

extern char retro_save_directory[];

int grok64_disk_attach(int unit, int drive, const char *path);

#define GROK64_DISK_PATH_MAX 4096
static int pending_disk_unit = 0;
static int pending_disk_drive = 0;
static char pending_disk_path[GROK64_DISK_PATH_MAX];
static int pending_disk_attach = 0;
static int last_disk_attach_rc = -1;

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
    if (!path || !path[0]) {
        return -1;
    }
    if (unit < 8 || unit > 11) {
        return -1;
    }
    if (drive < 0 || drive > 1) {
        drive = 0;
    }
    file_system_detach_disk((unsigned int)unit, (unsigned int)drive);
    last_disk_attach_rc = file_system_attach_disk((unsigned int)unit, (unsigned int)drive, path);
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
