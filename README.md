# Spectrometer

Browser-based, cross-platform alternative to **Theremino Spectrometer** for the
**Miyee 340–1050 nm** DIY spectrometer kit (also sold as **"The Little Garden"**
by Lao Kang — see his
[YouTube channel](https://www.youtube.com/@LaoKang2024/videos) for build videos
and demos of the device). Runs the camera through `getUserMedia` for sampling
and a small Node UVC server (`server.mjs`) for manual exposure / white-balance /
brightness control over libusb, since macOS does not surface those UVC controls
to the browser for this device.

## Device information

The hardware is the same Sonix-based USB spectrometer sold under several names:

- **Miyee 340–1050nm Spectrometer DIY Kit** ("Blue-ray / Full-spectrum / Laser /
  Absorption Spectrum Testing for Windows System")
- **"Little Garden" Spectrometer** (AliExpress, store 1103880729 / "Lao Kang")
- **"New Garden" Spectrometer**

Typical price is around US$80–120 / AU$120 depending on listing. Listings show
up on eBay, AliExpress, Alibaba, Thanksbuyer and Golyath (UK).

### Optical design

- **Wavelength range:** 340–1050 nm (advertised). Practical range is limited by
  the debayered CMOS camera's quantum-efficiency curve and the light path's
  dispersion — visible (~400–700 nm) is strong, NIR signal falls off, deep UV
  (<380 nm) is essentially noise.
- **Software resolution:** advertised at 1 nm; reviewers (Gough's Tech Zone,
  BudgetLightForum) report ~0.6 nm resolution achievable in the visible band.
  Distinguishes light sources separated by 1–2 nm.
- **Slit:** 3D-printed input slit assembly (single-piece printed frame with
  threaded metal inserts).
- **Grating:** delaminated DVD (~1350 lines/mm transmission grating) glued to
  the camera lens. Functional but the bonded construction means the grating
  cannot be swapped or re-tensioned.
- **Frame / case:** 3D-printed utility-box style enclosure with polyimide tape
  protecting optical surfaces in shipping.
- **Light input:** small port at one end of the box that interfaces with the
  3D-printed slit. Several reviewers add a 3D-printed light-collection jig
  with a lens and ambient-light shield to noticeably improve sensitivity.

### Camera / sensor

- **USB descriptor (verified on this unit via `ioreg -p IOUSB -l`):**
  - `idVendor`  = `0x0c68` (3176) — Sonix Technology Co., Ltd.
  - `idProduct` = `0x6464` (25700) — "USB 2.0 Camera"
  - `bcdDevice` = `0x2702` (firmware 27.02)
  - `bDeviceClass` / `SubClass` / `Protocol` = `0xEF` / `0x02` / `0x01`
    (Miscellaneous Device + IAD — UVC composite)
  - `iSerialNumber` = 0 (no serial — typical for this firmware; means you
    can't tell two units apart from USB metadata alone)
  - String descriptor: `"USB-ZH"`
  - Bus speed: USB 2.0 high-speed (480 Mbps), 500 mA bus-powered
  - Interface 0 (`bInterfaceClass 14 / SubClass 1`) = UVC VideoControl
  - Interface 1 (`bInterfaceClass 14 / SubClass 2`) = UVC VideoStreaming
- **Sensor:** 1920×1080 CMOS with the **Bayer color filter array physically
  removed** ("debayered" / monochrome conversion) before assembly. This is the
  single most important hardware mod — it boosts spectral sensitivity and
  removes the per-channel QE bumps that color webcam spectrometers fight.
- **Output formats:** MJPEG up to 30 fps at 1920×1080, or YUY2 at up to 5 fps
  at 1920×1080.
- **Connection:** USB-B port for both power and data, single cable.
- **Intensity linearity:** poor and not the point of this device — QE varies
  significantly across wavelength bins, and saturation behaviour is non-linear
  near full-well. Treat the y-axis as relative intensity, not absolute.

### macOS / Linux quirks

- On macOS the system UVC driver does **not** expose image controls to
  browsers: `MediaStreamTrack.getCapabilities()` returns only resolution,
  frame rate and `aspectRatio` — no `exposureMode`, `exposureTime`,
  `whiteBalanceMode`, `brightness`, `contrast`, etc. (Confirmed in both
  Chrome and Firefox.) Manual exposure/WB on this device on macOS therefore
  has to go through libusb / a Node helper, not the browser. This repo's
  `server.mjs` is exactly that helper.
- Exposure on the Sonix firmware is quantised in **32-tick blocks** — useful
  to know when stepping exposure programmatically or running sweeps (see
  `exposure-sweep.mjs`); intermediate values silently round.
- No vendor Linux/macOS app is shipped. The bundled software targets Windows
  only and is typically Theremino Spectrometer V5.x.

### What's in the box

Stock kit (depending on seller) includes:

1. Spectrometer unit (sealed, debayered camera + grating + slit pre-assembled)
2. USB cable (USB-A to USB-B)
3. Storage / carrying case
4. Light base / sample stand
5. **Calibration light source** — a small CFL fluorescent lamp; this is the
   reference for wavelength calibration (see below)
6. Soft light paper (diffuser)

### Calibration

The kit is **not wavelength-calibrated out of the box**. The accepted
procedure (from the Theremino guide, and used by this UI) is two-point linear
calibration against the mercury emission lines from the bundled CFL:

- 435.83 nm (Hg) — strong blue-violet
- 546.07 nm (Hg) — strong green

These two are the "safe" calibration points. Other CFL peaks (e.g. 577/579 nm
Hg doublet, terbium and europium lines from the phosphor at ~487, 542, 587,
611 nm, plus a weak 871.6 nm Hg line) are useful as cross-checks but have
typical errors of several nm depending on coating and run-in time, so they
shouldn't anchor the fit on their own. The Fraunhofer absorption lines in
sunlight provide a complementary calibration set in the red / NIR where Hg
gives you nothing.

Intensity / response calibration is genuinely hard on this device: the
non-linear QE curve and saturation behaviour mean a single broadband
reference (halogen bulb, candle) won't give you a clean correction — halogens
in particular are not close enough to a black body to use uncritically.

### Documented uses

From sellers' listings and reviewer reports:

- LED spectrum characterisation (peak wavelength, FWHM, blue-light "spike"
  on white LEDs)
- Monitor / phone-screen blue-light measurement
- Filter passband measurement (transmission spectroscopy)
- Absorption spectra (chlorophyll, food dyes, coloured solutions)
- Gas-discharge tube identification (neon, helium, xenon, mercury,
  deuterium, CO₂) — tested in the Hackaday writeup
- Laser line verification
- Educational demos of dispersion / spectroscopy

### Software ecosystem

- **Theremino Spectrometer V5.x** — the de-facto stock software the kit ships
  with; Windows only; documented at theremino.com. Two-point Hg calibration,
  averaging, wavelength-space filters. This project's calibration workflow
  (mercury 436 / 546 nm anchors plus optional Tb/Eu and Fraunhofer cross-
  checks) follows the same conventions so spectra captured here are directly
  comparable.
- **Lao Kang's YouTube channel** —
  [@LaoKang2024](https://www.youtube.com/@LaoKang2024/videos) — the maker
  behind "The Little Garden" / "New Garden" listings. Runs through assembly,
  calibration walk-throughs, and example measurements on the same hardware
  this project targets; the most accessible primary source for the device.
- **Spectral Workbench** (Public Lab) — open-source, browser-based.
- **`lgscli`** — community CLI for the Little Garden device.
- **This project** — browser UI + Node UVC server, intended for cross-platform
  use (especially macOS where the Theremino Windows app is unavailable).

### References

- [Lao Kang's YouTube channel (@LaoKang2024) — device maker, build & calibration videos](https://www.youtube.com/@LaoKang2024/videos)
- [Theremino Spectrometer V5.x manual (PDF)](https://www.theremino.com/wp-content/uploads/files/Theremino_Spectrometer_Help_ENG.pdf)
- [Quick Review: The Little Garden Spectrometer — Gough's Tech Zone](https://goughlui.com/2025/03/08/quick-review-the-little-garden-spectrometer/)
- [Little Garden spectrometer — BudgetLightForum thread](https://budgetlightforum.com/t/little-garden-spectrometer-impressions-opinions-discussion/225545)
- [Spectroscopy On The Cheap — Hackaday](https://hackaday.com/2024/09/27/spectroscopy-on-the-cheap/)
- [Miyee 340–1050nm DIY Kit — Golyath UK](https://www.golyath.co.uk/products/miyee-340-1050nm-spectrometer-for-windows-system-diy-spectroscopy-kit/)
