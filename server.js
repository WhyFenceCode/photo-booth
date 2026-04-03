const sharp = require("sharp");
const { exiftool } = require("exiftool-vendored");

const FRAME = {
  x: 1275,
  y: 850,
  width: 6450,
  height: 4300
};

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const OUTPUT_DIR = path.join(__dirname, "temp");
const PROCESSED_DIR = path.join(__dirname, "processed");
const DATA_FILE = path.join(__dirname, "data.json");

[OUTPUT_DIR, PROCESSED_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
});

if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ counter: 0 }, null, 2));
}

function getNextFilename() {
  const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  data.counter = (data.counter || 0) + 1;
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  const padded = String(data.counter).padStart(4, "0");
  return `${padded}.jpg`;
}

function startListener() {
  const gp = spawn("gphoto2", ["--wait-event-and-download"]);
  console.log("📡 Listening for new photos...");

  gp.stdout.on("data", data => {
    const text = data.toString();
    process.stdout.write(text);

    const match = text.match(/Saving file as (.+\.(jpg|jpeg|JPG|JPEG))/);
    if (match) {
      const filename = match[1];
      handleNewFile(filename);
    }
  });

  gp.stderr.on("data", data => console.error("⚠️ gphoto2 error:", data.toString()));
  gp.on("close", code => {
    console.log(`gphoto2 exited (${code}). Restarting...`);
    setTimeout(startListener, 1000);
  });
}

function handleNewFile(filename) {
  const srcPath = path.resolve(filename);
  if (!fs.existsSync(srcPath)) {
    console.error("❌ File not found:", srcPath);
    return;
  }

  const nextFilename = getNextFilename();
  const newFilename = "TEMP_" + nextFilename;
  const finalFilename = "FINAL_" + nextFilename;
  const destPath = path.join(OUTPUT_DIR, newFilename);
  const processedPath = path.join(PROCESSED_DIR, finalFilename);

  fs.rename(srcPath, destPath, err => {
    if (err) {
      console.error("❌ Move failed:", err);
      return;
    }
    console.log("✅ Photo temp saved →", destPath);
    applyBorder(destPath, processedPath);
  });
}

async function detectOrientation(filePath) {
  const metadata = await exiftool.read(filePath);
  const orientation = metadata.Orientation;

  console.log(`Orientation: ${orientation}`);

  return orientation;
}

async function applyBorder(inputPath, outputPath) {
  const orientation = await detectOrientation(inputPath);
  const portraitOrientation = [6, 8];

  const borderFile = portraitOrientation.includes(orientation) ? "border-portrait.png" : "border.png";
  let rotationAngle = 0;
  
  if (orientation === 8) { 
    rotationAngle = 180;
  }

  const resized = await sharp(inputPath)
    .resize(FRAME.width, FRAME.height, { fit: "fill" })
    .rotate(rotationAngle)
    .toBuffer();

  await sharp(borderFile)
    .composite([
      { input: resized, left: FRAME.x, top: FRAME.y }
    ])
    .toFile(outputPath);

  console.log(`✅ Photo processed (${orientation}) →`, outputPath);
}

startListener();