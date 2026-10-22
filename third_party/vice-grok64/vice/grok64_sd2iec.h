/*
 * Grok64 SD2IEC — VICE IEC bus device backed by JS (Emscripten imports).
 */
#ifndef GROK64_SD2IEC_H
#define GROK64_SD2IEC_H

#include "types.h"

void grok64_sd2iec_init(void);
void grok64_sd2iec_reset(void);

int grok64_sd2iec_handles_device(unsigned int device);

void grok64_sd2iec_open(unsigned int device, uint8_t secondary, void (*st_func)(uint8_t));
void grok64_sd2iec_close(unsigned int device, uint8_t secondary, void (*st_func)(uint8_t));
void grok64_sd2iec_listentalk(unsigned int device, uint8_t secondary, void (*st_func)(uint8_t));
void grok64_sd2iec_unlisten(unsigned int device, uint8_t secondary, void (*st_func)(uint8_t));
void grok64_sd2iec_untalk(unsigned int device, uint8_t secondary, void (*st_func)(uint8_t));
void grok64_sd2iec_write(unsigned int device, uint8_t secondary, uint8_t data, void (*st_func)(uint8_t));
uint8_t grok64_sd2iec_read(unsigned int device, uint8_t secondary, void (*st_func)(uint8_t));

#endif
