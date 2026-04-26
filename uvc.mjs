// Raw UVC controller for the Sonix-based "Little Garden" spectrometer camera.
// Bypasses uvcc (which has a bug with this device) by sending control transfers
// directly via node-usb. Used by server.mjs (HTTP API).

import { findByIds, usb } from 'usb';

export const VENDOR_ID = 0x0c68;
export const PRODUCT_ID = 0x6464;

const SET_CUR = 0x01, GET_CUR = 0x81, GET_MIN = 0x82, GET_MAX = 0x83, GET_DEF = 0x87;
const TYPE_GET = 0xA1, TYPE_SET = 0x21;
const IFACE = 0;

// Each control: which UVC unit it lives on, its selector, byte length,
// signedness, friendly metadata, and the UI "kind" (range/select/toggle).
// Selectors come from USB Device Class Definition for Video Devices, v1.1/1.5.
export const CONTROLS = {
  // Camera Terminal (unit 1)
  ae_mode: {
    unit: 1, sel: 0x02, len: 1, signed: false,
    label: 'Auto Exposure Mode',
    desc: 'UVC bitmap; this camera supports Manual and Aperture Priority (no iris)',
    kind: 'select',
    options: [
      { value: 1, label: 'Manual',           hint: 'manual exposure, manual iris' },
      { value: 2, label: 'Auto',             hint: 'auto exposure, auto iris' },
      { value: 4, label: 'Shutter Priority', hint: 'manual exposure, auto iris' },
      { value: 8, label: 'Aperture Priority',hint: 'auto exposure, manual iris (camera default)' },
    ],
  },
  ae_priority: {
    unit: 1, sel: 0x03, len: 1, signed: false,
    label: 'AE Priority',
    desc: 'Whether auto-exposure may vary frame rate',
    kind: 'toggle',
    options: [
      { value: 0, label: 'Constant frame rate' },
      { value: 1, label: 'Variable frame rate' },
    ],
  },
  exposure: {
    unit: 1, sel: 0x04, len: 4, signed: false,
    label: 'Exposure Time',
    desc: 'Units of 100µs (1=0.1ms, 5000=500ms). Effective when AE Mode = Manual or Shutter Priority.',
    kind: 'range',
  },

  // Processing Unit (unit 2)
  brightness: { unit: 2, sel: 0x02, len: 2, signed: true,  label: 'Brightness',             desc: 'Digital offset',   kind: 'range' },
  contrast:   { unit: 2, sel: 0x03, len: 2, signed: false, label: 'Contrast',               desc: '',                 kind: 'range' },
  hue:        { unit: 2, sel: 0x06, len: 2, signed: true,  label: 'Hue',                    desc: '',                 kind: 'range' },
  saturation: { unit: 2, sel: 0x07, len: 2, signed: false, label: 'Saturation',             desc: '0 = grayscale',    kind: 'range' },
  sharpness:  { unit: 2, sel: 0x08, len: 2, signed: false, label: 'Sharpness',              desc: '',                 kind: 'range' },
  gamma:      { unit: 2, sel: 0x09, len: 2, signed: false, label: 'Gamma',                  desc: '',                 kind: 'range' },
  wb_temp:    { unit: 2, sel: 0x0A, len: 2, signed: false, label: 'White Balance Temp (K)', desc: 'Only effective when WB Auto is off', kind: 'range' },
  wb_auto: {
    unit: 2, sel: 0x0B, len: 1, signed: false,
    label: 'White Balance Auto',
    desc: 'Continuous auto white balance',
    kind: 'toggle',
    options: [
      { value: 0, label: 'Off' },
      { value: 1, label: 'On' },
    ],
  },
  backlight: { unit: 2, sel: 0x01, len: 2, signed: false, label: 'Backlight Compensation', desc: '', kind: 'range' },
  power_line: {
    unit: 2, sel: 0x05, len: 1, signed: false,
    label: 'Power Line Frequency',
    desc: 'Anti-flicker filter for AC-powered light sources',
    kind: 'select',
    options: [
      { value: 0, label: 'Disabled' },
      { value: 1, label: '50 Hz' },
      { value: 2, label: '60 Hz' },
    ],
  },
};

const readN = (b, n, signed) =>
  n === 1 ? (signed ? b.readInt8(0)    : b.readUInt8(0))    :
  n === 2 ? (signed ? b.readInt16LE(0) : b.readUInt16LE(0)) :
  n === 4 ? (signed ? b.readInt32LE(0) : b.readUInt32LE(0)) : null;

const writeN = (v, n, signed) => {
  const b = Buffer.alloc(n);
  if (n === 1)      signed ? b.writeInt8(v, 0)    : b.writeUInt8(v, 0);
  else if (n === 2) signed ? b.writeInt16LE(v, 0) : b.writeUInt16LE(v, 0);
  else if (n === 4) signed ? b.writeInt32LE(v, 0) : b.writeUInt32LE(v, 0);
  return b;
};

// Errno values that mean "the cached device handle is no longer usable" — the
// device was unplugged, the kernel reclaimed the interface, or the OS rejected
// the handle. Any of these mean we need to drop the handle and re-acquire.
const DEAD_HANDLE_ERRNO = new Set([
  -4, // LIBUSB_ERROR_NO_DEVICE
  -5, // LIBUSB_ERROR_NOT_FOUND
  -1, // LIBUSB_ERROR_IO (sometimes seen on abrupt unplug)
]);

export class UvcCamera {
  constructor() {
    this.device = null;
    this._installHotplug();
  }

  _installHotplug() {
    if (UvcCamera._hotplugInstalled) return;
    UvcCamera._hotplugInstalled = true;
    // Drop any cached handle as soon as the kernel tells us the device is gone.
    // Without this, the next control transfer would have to fail first before
    // we'd notice; with it, /api/health flips to "camera disconnected" almost
    // immediately after the user yanks the cable.
    usb.on('detach', (dev) => {
      const d = dev.deviceDescriptor;
      if (!d || d.idVendor !== VENDOR_ID || d.idProduct !== PRODUCT_ID) return;
      for (const inst of UvcCamera._instances) inst._handleDetach();
    });
  }

  open() {
    if (this.device) return;
    const dev = findByIds(VENDOR_ID, PRODUCT_ID);
    if (!dev) throw new Error(`Camera not found (vendor 0x${VENDOR_ID.toString(16)}, product 0x${PRODUCT_ID.toString(16)})`);
    dev.open();
    this.device = dev;
    UvcCamera._instances.add(this);
  }

  close() {
    UvcCamera._instances.delete(this);
    if (this.device) {
      try { this.device.close(); } catch {}
      this.device = null;
    }
  }

  isOpen() { return !!this.device; }

  _handleDetach() {
    // Device gone: drop the handle without trying to .close() it (libusb will
    // throw on a closed device). The next open() call will re-find it.
    this.device = null;
    UvcCamera._instances.delete(this);
  }

  _transfer(dir, req, sel, unit, lenOrBuf) {
    return new Promise((resolve, reject) => {
      this.device.controlTransfer(dir, req, sel << 8, (unit << 8) | IFACE, lenOrBuf,
        (err, data) => {
          if (err) {
            if (DEAD_HANDLE_ERRNO.has(err.errno)) this._handleDetach();
            return reject(err);
          }
          resolve(data);
        });
    });
  }

  async _getRaw(req, ctl) {
    return readN(await this._transfer(TYPE_GET, req, ctl.sel, ctl.unit, ctl.len), ctl.len, ctl.signed);
  }

  async getValue(name) {
    const ctl = CONTROLS[name];
    if (!ctl) throw new Error(`unknown control "${name}"`);
    return this._getRaw(GET_CUR, ctl);
  }

  async getInfo(name) {
    const ctl = CONTROLS[name];
    if (!ctl) throw new Error(`unknown control "${name}"`);
    const result = {
      name,
      label: ctl.label,
      desc: ctl.desc,
      len: ctl.len,
      signed: ctl.signed,
      kind: ctl.kind ?? 'range',
    };
    if (ctl.options) result.options = ctl.options;
    try { result.value   = await this._getRaw(GET_CUR, ctl); } catch (e) { result.value_error = e.message; }
    try { result.min     = await this._getRaw(GET_MIN, ctl); } catch {}
    try { result.max     = await this._getRaw(GET_MAX, ctl); } catch {}
    try { result.default = await this._getRaw(GET_DEF, ctl); } catch {}
    return result;
  }

  async setValue(name, value) {
    const ctl = CONTROLS[name];
    if (!ctl) throw new Error(`unknown control "${name}"`);
    await this._transfer(TYPE_SET, SET_CUR, ctl.sel, ctl.unit, writeN(value, ctl.len, ctl.signed));
    return this._getRaw(GET_CUR, ctl);
  }

  async listAll() {
    const out = [];
    for (const name of Object.keys(CONTROLS)) {
      out.push(await this.getInfo(name));
    }
    return out;
  }
}

UvcCamera._hotplugInstalled = false;
UvcCamera._instances = new Set();
