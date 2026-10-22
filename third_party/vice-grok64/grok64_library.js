mergeInto(LibraryManager.library, {
  grok64_js_iec_open: function (device, secondary) {
    if (typeof Module !== "undefined" && Module.grok64Host && Module.grok64Host.iecOpen) {
      Module.grok64Host.iecOpen(device, secondary);
    }
  },
  grok64_js_iec_close: function (device, secondary) {
    if (typeof Module !== "undefined" && Module.grok64Host && Module.grok64Host.iecClose) {
      Module.grok64Host.iecClose(device, secondary);
    }
  },
  grok64_js_iec_listentalk: function (device, secondary) {
    if (typeof Module !== "undefined" && Module.grok64Host && Module.grok64Host.iecListenTalk) {
      Module.grok64Host.iecListenTalk(device, secondary);
    }
  },
  grok64_js_iec_unlisten: function (device, secondary) {
    if (typeof Module !== "undefined" && Module.grok64Host && Module.grok64Host.iecUnlisten) {
      Module.grok64Host.iecUnlisten(device, secondary);
    }
  },
  grok64_js_iec_untalk: function (device, secondary) {
    if (typeof Module !== "undefined" && Module.grok64Host && Module.grok64Host.iecUntalk) {
      Module.grok64Host.iecUntalk(device, secondary);
    }
  },
  grok64_js_iec_write: function (device, secondary, data) {
    if (typeof Module !== "undefined" && Module.grok64Host && Module.grok64Host.iecWrite) {
      Module.grok64Host.iecWrite(device, secondary, data);
    }
  },
  grok64_js_iec_read: function (device, secondary) {
    if (typeof Module !== "undefined" && Module.grok64Host && Module.grok64Host.iecRead) {
      return Module.grok64Host.iecRead(device, secondary) & 255;
    }
    return 255;
  },
  grok64_js_iec_st: function (device, st) {
    if (typeof Module !== "undefined" && Module.grok64Host && Module.grok64Host.iecSt) {
      Module.grok64Host.iecSt(device, st);
    }
  },
});
