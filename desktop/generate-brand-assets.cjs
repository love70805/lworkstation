const { app, BrowserWindow, nativeImage } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MASTER_SHA256 = "07A556FA1A57EC9E147138CFA97443214FF63AB0E67CB4B3AD10EB4A5708DA53";
const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256];
const masterPath = path.resolve(__dirname, "../frontend/public/assets/brand/l7-app-icon-master.svg");
const assetsDirectory = path.join(__dirname, "assets");
const pngPath = path.join(assetsDirectory, "lworkstation.png");
const icoPath = path.join(assetsDirectory, "lworkstation.ico");

app.commandLine.appendSwitch("force-device-scale-factor", "1");

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex").toUpperCase();
}

function createIco(images) {
  const headerSize = 6 + images.length * 16;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = headerSize;
  images.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size === 256 ? 0 : size, entry);
    header.writeUInt8(size === 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });

  return Buffer.concat([header, ...images.map(({ png }) => png)]);
}

async function generate() {
  await app.whenReady();
  const source = fs.readFileSync(masterPath, "utf8").replace(/\r\n/g, "\n");
  const sourceBuffer = Buffer.from(source, "utf8");
  if (sha256(sourceBuffer) !== MASTER_SHA256) {
    throw new Error(`L7 master SHA-256 mismatch: ${sha256(sourceBuffer)}`);
  }

  const renderer = new BrowserWindow({
    width: 1024,
    height: 1024,
    useContentSize: true,
    show: false,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      offscreen: true,
    },
  });
  const document = `<!doctype html><style>html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent}svg{display:block;width:100%;height:100%}</style>${source}`;
  await renderer.loadURL(`data:text/html;base64,${Buffer.from(document).toString("base64")}`);
  const captured = await renderer.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  renderer.destroy();
  const image = nativeImage.createFromBuffer(captured.toPNG());
  if (image.isEmpty() || image.getSize().width !== 1024 || image.getSize().height !== 1024) {
    throw new Error(`Electron rendered an invalid L7 master size: ${JSON.stringify(image.getSize())}`);
  }

  fs.mkdirSync(assetsDirectory, { recursive: true });
  const png = image.resize({ width: 1024, height: 1024, quality: "best" }).toPNG();
  const icoImages = ICON_SIZES.map((size) => ({
    size,
    png: image.resize({ width: size, height: size, quality: "best" }).toPNG(),
  }));
  const ico = createIco(icoImages);
  fs.writeFileSync(pngPath, png);
  fs.writeFileSync(icoPath, ico);

  console.log(JSON.stringify({
    master: { path: masterPath, sha256: MASTER_SHA256 },
    png: { path: pngPath, bytes: png.length, sha256: sha256(png) },
    ico: { path: icoPath, bytes: ico.length, sha256: sha256(ico), sizes: ICON_SIZES },
  }, null, 2));
}

generate()
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
