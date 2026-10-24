#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#endif

#include "libretro.h"
#include "attach.h"
#include "kbdbuf.h"
#include "machine.h"
#include <stdint.h>
#include <string.h>

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
    if (unit < 8 || unit > 11) {
        return "";
    }
    if (drive < 0 || drive > 1) {
        drive = 0;
    }
    const char *name = file_system_get_disk_name((unsigned int)unit, (unsigned int)drive);
    return name ? name : "";
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
    return file_system_attach_disk((unsigned int)unit, (unsigned int)drive, path);
}
