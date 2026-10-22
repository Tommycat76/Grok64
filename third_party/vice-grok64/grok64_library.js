/**
 * Emscripten JS library — forwards to host functions set on Module.grok64Host.
 */
mergeInto(LibraryManager.library, {
  grok64_sd2iec_attach: function (unit) {
    if (typeof Module.grok64Host?.sd2iecAttach === "function") Module.grok64Host.sd2iecAttach(unit);
  },
  grok64_sd2iec_poll: function () {
    if (typeof Module.grok64Host?.sd2iecPoll === "function") Module.grok64Host.sd2iecPoll();
  },
  grok64_c64_read: function (addr) {
    if (typeof Module.grok64Host?.c64Read === "function") return Module.grok64Host.c64Read(addr) & 0xff;
    return 0;
  },
  grok64_c64_write: function (addr, value) {
    if (typeof Module.grok64Host?.c64Write === "function") Module.grok64Host.c64Write(addr, value);
  },
});
