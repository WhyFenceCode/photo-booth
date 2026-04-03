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

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR);
}

if (!fs.existsSync(PROCESSED_DIR)) {
  fs.mkdirSync(PROCESSED_DIR);
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

      applyBorder(destPath, processedPath);
    });
  }, 500);
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