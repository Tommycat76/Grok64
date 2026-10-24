/*
 * Grok64 SD2IEC IEC backend — forwards serial-iec-bus to JS host imports.
 */
#include "vice.h"

#ifdef __EMSCRIPTEN__

#include <stdio.h>
#include <string.h>

#include "grok64_sd2iec.h"
#include "resources.h"
#include "drive.h"

static int grok64_units[16];

void grok64_sd2iec_disable_unit(int unit)
{
    char res[24];
    if (unit < 4 || unit > 11) {
        return;
    }
    grok64_units[unit] = 0;
    snprintf(res, sizeof res, "IECDevice%d", unit);
    resources_set_int(res, 0);
    snprintf(res, sizeof res, "FileSystemDevice%d", unit);
    resources_set_int(res, 0);
}

void grok64_sd2iec_enable_unit(int unit)
{
    char res[24];
    if (unit < 4 || unit > 11) {
        return;
    }
    grok64_units[unit] = 1;
    snprintf(res, sizeof res, "Drive%dType", unit);
    resources_set_int(res, DRIVE_TYPE_NONE);
    snprintf(res, sizeof res, "IECDevice%d", unit);
    resources_set_int(res, 1);
    snprintf(res, sizeof res, "FileSystemDevice%d", unit);
    resources_set_int(res, 0);
}

extern void grok64_js_iec_open(unsigned int device, uint8_t secondary);
extern void grok64_js_iec_close(unsigned int device, uint8_t secondary);
extern void grok64_js_iec_listentalk(unsigned int device, uint8_t secondary);
extern void grok64_js_iec_unlisten(unsigned int device, uint8_t secondary);
extern void grok64_js_iec_untalk(unsigned int device, uint8_t secondary);
extern void grok64_js_iec_write(unsigned int device, uint8_t secondary, uint8_t data);
extern int grok64_js_iec_read(unsigned int device, uint8_t secondary);
extern int grok64_js_iec_read_st(void);
extern void grok64_js_iec_st(unsigned int device, uint8_t st);

void grok64_sd2iec_init(void)
{
    memset(grok64_units, 0, sizeof grok64_units);
}

void grok64_sd2iec_reset(void)
{
}

int grok64_sd2iec_handles_device(unsigned int device)
{
    unsigned int u = device & 0x0f;
    return u < 16 && grok64_units[u];
}

static void call_st(void (*st_func)(uint8_t), uint8_t st)
{
    if (st_func) {
        st_func(st);
    }
    grok64_js_iec_st(0, st);
}

void grok64_sd2iec_open(unsigned int device, uint8_t secondary, void (*st_func)(uint8_t))
{
    grok64_js_iec_open(device, secondary);
    call_st(st_func, 0);
}

void grok64_sd2iec_close(unsigned int device, uint8_t secondary, void (*st_func)(uint8_t))
{
    grok64_js_iec_close(device, secondary);
    call_st(st_func, 0);
}

void grok64_sd2iec_listentalk(unsigned int device, uint8_t secondary, void (*st_func)(uint8_t))
{
    grok64_js_iec_listentalk(device, secondary);
    call_st(st_func, 0);
}

void grok64_sd2iec_unlisten(unsigned int device, uint8_t secondary, void (*st_func)(uint8_t))
{
    grok64_js_iec_unlisten(device, secondary);
    call_st(st_func, 0);
}

void grok64_sd2iec_untalk(unsigned int device, uint8_t secondary, void (*st_func)(uint8_t))
{
    grok64_js_iec_untalk(device, secondary);
    call_st(st_func, 0);
}

void grok64_sd2iec_write(unsigned int device, uint8_t secondary, uint8_t data, void (*st_func)(uint8_t))
{
    grok64_js_iec_write(device, secondary, data);
    call_st(st_func, 0);
}

uint8_t grok64_sd2iec_read(unsigned int device, uint8_t secondary, void (*st_func)(uint8_t))
{
    int v = grok64_js_iec_read(device, secondary);
    call_st(st_func, (uint8_t)grok64_js_iec_read_st());
    return (uint8_t)(v & 0xff);
}

#endif /* __EMSCRIPTEN__ */
