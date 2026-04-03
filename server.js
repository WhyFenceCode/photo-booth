const sharp = require("sharp");
const FRAME = {
  x: 1275,
  y: 850,
  width: 6450,
  height: 4300
};
const useLUT = true; // Set to true if you have a LUT file and want to apply it
let LUT = null;
let LUT_SIZE = 0;

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const OUTPUT_DIR = path.join(__dirname, "temp");
const PROCESSED_DIR = path.join(__dirname, "processed");

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR);
}

if (!fs.existsSync(PROCESSED_DIR)) {
  fs.mkdirSync(PROCESSED_DIR);
}

function loadCubeLUT(cubePath) {
  const lines = fs.readFileSync(cubePath, "utf-8")
    .split("\n")
    .filter(l => l && !l.startsWith("#") && !l.startsWith("TITLE") && !l.startsWith("LUT_"));

  LUT_SIZE = Math.round(Math.cbrt(lines.length));
  LUT = lines.map(l => l.trim().split(/\s+/).map(Number));

  console.log(`✅ Cube LUT loaded: ${lines.length} entries (${LUT_SIZE}³)`);
}

function getLUTValue(r, g, b) {
  const N = LUT_SIZE;
  const fx = r * (N - 1);
  const fy = g * (N - 1);
  const fz = b * (N - 1);

  const x0 = Math.floor(fx), x1 = Math.min(x0 + 1, N - 1);
  const y0 = Math.floor(fy), y1 = Math.min(y0 + 1, N - 1);
  const z0 = Math.floor(fz), z1 = Math.min(z0 + 1, N - 1);

  const xd = fx - x0;
  const yd = fy - y0;
  const zd = fz - z0;

  function idx(xx, yy, zz) {
    return xx + yy * N + zz * N * N;
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  const c000 = LUT[idx(x0, y0, z0)];
  const c100 = LUT[idx(x1, y0, z0)];
  const c010 = LUT[idx(x0, y1, z0)];
  const c110 = LUT[idx(x1, y1, z0)];
  const c001 = LUT[idx(x0, y0, z1)];
  const c101 = LUT[idx(x1, y0, z1)];
  const c011 = LUT[idx(x0, y1, z1)];
  const c111 = LUT[idx(x1, y1, z1)];

  const c00 = c000.map((v,i) => lerp(v, c100[i], xd));
  const c01 = c001.map((v,i) => lerp(v, c101[i], xd));
  const c10 = c010.map((v,i) => lerp(v, c110[i], xd));
  const c11 = c011.map((v,i) => lerp(v, c111[i], xd));

  const c0 = c00.map((v,i) => lerp(v, c10[i], yd));
  const c1 = c01.map((v,i) => lerp(v, c11[i], yd));

  return c0.map((v,i) => lerp(v, c1[i], zd));
}

function startListener() {
  const gp = spawn("gphoto2", [
    "--wait-event-and-download"
]);

  console.log("📡 Listening for new photos...");

  gp.stdout.on("data", (data) => {
    const text = data.toString();
    process.stdout.write(text);

    const match = text.match(/Saving file as (.+\.(jpg|jpeg|JPG|JPEG))/);

    if (match) {
      const filename = match[1];
      handleNewFile(filename);
    }
  });

  gp.stderr.on("data", (data) => {
    console.error("⚠️ gphoto2 error:", data.toString());
  });

  gp.on("close", (code) => {
    console.log(`gphoto2 exited (${code}). Restarting...`);
    setTimeout(startListener, 1000);
  });
}

function handleNewFile(filename) {
  const srcPath = path.resolve(filename);
  const destPath = path.join(OUTPUT_DIR, path.basename(filename));
  const processedPath = path.join(PROCESSED_DIR, path.basename(filename));

  setTimeout(() => {
    if (!fs.existsSync(srcPath)) {
      console.error("❌ File not found:", srcPath);
      return;
    }

    fs.rename(srcPath, destPath, (err) => {
      if (err) {
        console.error("❌ Move failed:", err);
        return;
      }

      console.log("✅ Photo temp saved →", destPath);

      applyProcess(destPath, processedPath);
    });
  }, 500);
}

async function applyLUTToBuffer(buffer) {
  const { data, info } = await sharp(buffer)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const out = Buffer.alloc(data.length);

  for (let i = 0; i < data.length; i += 3) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;

    const [lr, lg, lb] = getLUTValue(r, g, b);

    out[i]     = Math.round(Math.min(Math.max(lr * 255, 0), 255));
    out[i + 1] = Math.round(Math.min(Math.max(lg * 255, 0), 255));
    out[i + 2] = Math.round(Math.min(Math.max(lb * 255, 0), 255));
  }

  return { data: out, width: info.width, height: info.height, channels: 3 };
}

async function applyProcess(inputPath, outputPath) {
  let image = sharp(inputPath); // start from JPEG

  // Apply LUT if needed
  if (useLUT) {
    const lutApplied = await applyLUTToBuffer(await image.toBuffer());
    image = sharp(lutApplied.data, {
      raw: {
        width: lutApplied.width,
        height: lutApplied.height,
        channels: lutApplied.channels
      }
    });
  }

  const resized = await image
    .resize(FRAME.width, FRAME.height, { fit: "fill" })
    .toBuffer();

  // Composite onto border
  await sharp("border.png")
  .composite([{
      input: resized,
      raw: { width: FRAME.width, height: FRAME.height, channels: 3 },
      left: FRAME.x,
      top: FRAME.y
  }])
  .jpeg() // explicitly save as JPEG
  .toFile(outputPath);

  console.log("✅ Photo processed →", outputPath);
}

loadCubeLUT("lut.cube");
startListener();