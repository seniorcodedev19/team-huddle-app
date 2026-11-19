/* Draws every icon the desktop app uses from the web app's own logo
   (apps/web/public/icon.svg), so the two can never drift apart.

     npm run icons

   Run it again only when the logo changes; the results are checked in.
   It uses Electron itself as the drawing tool: a hidden page rasterises the
   SVG onto a canvas at each size, which needs no image library. */

const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const svg = fs.readFileSync(path.join(root, "..", "apps", "web", "public", "icon.svg"), "utf8");

/* Runs inside the hidden page. */
const painter = `
(() => {
  const RED = "#e5484d";
  async function logo(svg, size, dot) {
    const img = new Image();
    img.src = "data:image/svg+xml;base64," + btoa(svg);
    await img.decode();
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0, size, size);
    if (dot) {
      // The unread mark: a red dot in the corner, ringed so it reads on any taskbar.
      const r = size * 0.27;
      g.beginPath();
      g.arc(size - r, r, r, 0, Math.PI * 2);
      g.fillStyle = "#ffffff";
      g.fill();
      g.beginPath();
      g.arc(size - r, r, r * 0.74, 0, Math.PI * 2);
      g.fillStyle = RED;
      g.fill();
    }
    return c.toDataURL("image/png");
  }
  function badge(label, size) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    g.beginPath();
    g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    g.fillStyle = RED;
    g.fill();
    g.fillStyle = "#ffffff";
    g.font = "700 " + (label.length > 1 ? size * 0.56 : size * 0.72) + "px 'Segoe UI', Arial, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(label, size / 2, size / 2 + size * 0.04);
    return c.toDataURL("image/png");
  }
  return { logo, badge };
})()`;

const png = (dataUrl) => Buffer.from(dataUrl.split(",")[1], "base64");

/* An .ico is a small directory followed by the images. Windows has accepted
   PNG-encoded entries since Vista, so the PNGs go in as they are. */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  await win.loadURL("about:blank");
  const run = (expr) => win.webContents.executeJavaScript(`(async () => { const p = ${painter}; return ${expr}; })()`);
  const logo = async (size, dot = false) => png(await run(`p.logo(${JSON.stringify(svg)}, ${size}, ${dot})`));

  const write = (rel, data) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
    console.log(`${rel}  ${data.length} bytes`);
  };

  write("build/icon.png", await logo(512));
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = [];
  for (const size of sizes) images.push({ size, data: await logo(size) });
  write("build/icon.ico", ico(images));

  write("static/icon.png", await logo(256));
  write("static/tray.png", await logo(16));
  write("static/tray@2x.png", await logo(32));
  write("static/tray-unread.png", await logo(16, true));
  write("static/tray-unread@2x.png", await logo(32, true));
  for (const label of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "9+"]) {
    const name = label === "9+" ? "9plus" : label;
    write(`static/badge-${name}.png`, png(await run(`p.badge(${JSON.stringify(label)}, 32)`)));
  }
  app.quit();
});
