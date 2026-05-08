const sharp = require("sharp");
const { exiftool } = require("exiftool-vendored");
const { exec } = require("child_process");
const readline = require("readline");
const { styleText } = require('node:util');

const HorizontalFRAME = {
  x: 0,
  y: 0,
  width: 7395,
  height: 4930
};

const VerticalFRAME = {
  x: 0,
  y: 1070,
  width: 7395,
  height: 4930
};

print = false;

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { start } = require("node:repl");

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

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askCopies() {
  return new Promise(resolve => {
    rl.question("🖨️  Number of copies? (default 1): ", answer => {
      const parsed = parseInt(answer.trim(), 10);
      resolve(isNaN(parsed) || parsed <= 0 ? 1 : parsed);
    });
  });
}

function progressBar(step, total) {
  const inside = "▒".repeat(step) + "⠀".repeat(total - step);
  return `${inside}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function renderBar(before, current, color, spacer) {
  const barLength = 50;

  for (let i = 0; i <= barLength; i++) {
    console.clear();
    console.log(before);
    console.log(current);
    console.log("");

    const bar = styleText(['black', 'bold', `${color}`], progressBar(i, barLength));
    const barText = spacer + "[" + bar + "] " + i + "/" + barLength;
    console.log(barText);

    await sleep(10 + Math.random() * 20);
  }
}

async function startUp() {
  const spacerText = " ".repeat(10);
  const smallSpacerText = " ".repeat(4);
  const emptyLine = "";
  const newLine = "\n";

  const fullBar = "[✅]"

  const coreText = styleText(['black', 'bold', 'bgGreen'], ' core ');
  const cameraText = styleText(['black', 'bold', 'bgMagenta'], ' camera ');
  const tempText = styleText(['black', 'bold', 'bgMagenta'], ' temp ');
  const printText = styleText(['black', 'bold', 'bgMagenta'], ' print ');

  const coreValueText = styleText(['black', 'bold'], 'Starting Launch Sequence');
  const cameraValueText = styleText(['black', 'bold'], 'Loading Camera Integration');
  const tempValueText = styleText(['black', 'bold'], 'Preparing Temp Storage');
  const printValueText = styleText(['black', 'bold'], 'Connecting Printer');

  const coreCompleteText = "\n" + spacerText + coreText + smallSpacerText + coreValueText + "\n\n" + spacerText + fullBar + "\n\n";
  const cameraCompleteText = "\n" + spacerText + cameraText + smallSpacerText + cameraValueText + "\n\n" + spacerText + fullBar + "\n\n";
  const tempCompleteText = "\n" + spacerText + tempText + smallSpacerText + tempValueText + "\n\n" + spacerText + fullBar + "\n\n";
  const printCompleteText = "\n" + spacerText + printText + smallSpacerText + printValueText + "\n\n" + spacerText + fullBar + "\n\n";

  console.clear();

  await renderBar(emptyLine, spacerText + coreText + smallSpacerText + coreValueText, 'blue', spacerText);
  await renderBar(coreCompleteText, spacerText + cameraText + smallSpacerText + cameraValueText, 'blue', spacerText);
  await renderBar(coreCompleteText + cameraCompleteText, spacerText + tempText + smallSpacerText + tempValueText, 'blue', spacerText);
  await renderBar(coreCompleteText + cameraCompleteText + tempCompleteText, spacerText + printText + smallSpacerText + printValueText, 'blue', spacerText);

  console.clear();

  console.log(coreCompleteText + cameraCompleteText + tempCompleteText + printCompleteText);
  console.log("\n");
}

function startListener() {
  console.clear()
  startUp()
  .then(() => {
    const gp = spawn("gphoto2", ["--wait-event-and-download"]);

      gp.stdout.on("data", data => {
      const text = data.toString();
      //process.stdout.write(text);

      const match = text.match(/Saving file as (.+\.(jpg|jpeg|JPG|JPEG))/);
      if (match) {
        const filename = match[1];
        handleNewFile(filename);
      }
    });

    gp.stderr.on("data", data => {
      console.error("          ", styleText(['black', 'bold', 'bgYellow'], ' camera '), "    ", "ERROR FINDING CAMERA", "\n");
    });
    gp.on("close", code => {
      console.log("          ", styleText(['black', 'bold', 'bgRed'], ' camera '), "    ", "FORCE EXIT ", code, " RESTARTING");
      setTimeout(startListener, 1000);
    });
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
    //console.log("✅ Photo temp saved →", destPath);
    applyBorder(destPath, processedPath);
  });
}

async function detectOrientation(filePath) {
  const metadata = await exiftool.read(filePath);
  const orientation = metadata.Orientation;

  return orientation;
}

function printPhoto(filePath, copies) {
  const printerName = "ojet";

  exec(
    `lp -d ${printerName} \
     -n ${copies} \
     -o fit-to-page \
     -o print-quality=5 \
     "${filePath}"`,
    (err) => {
      if (err) {
        console.error("❌ Print failed:", err);
        return;
      }
      console.log("🖨️ Printed:", filePath);
    }
  );
}

async function applyBorder(inputPath, outputPath) {
  const orientation = await detectOrientation(inputPath);
  const portraitOrientation = [6, 8];

  const borderFile = portraitOrientation.includes(orientation) ? "Vertical.png" : "Horizontal.png";
  let rotationAngle = 0;
  
  if (orientation === 8) { 
    rotationAngle = 180;
  }

  const FRAME = portraitOrientation.includes(orientation) ? VerticalFRAME : HorizontalFRAME;

  const resized = await sharp(inputPath)
    .resize(FRAME.width, FRAME.height, { fit: "fill" })
    .rotate(rotationAngle)
    .toBuffer();

  await sharp(borderFile)
    .composite([
      { input: resized, left: FRAME.x, top: FRAME.y }
    ])
    .toFile(outputPath);

  console.log(`✅ Photo processed →`, outputPath);

  if (print) {
    const copies = await askCopies();
    await printPhoto(outputPath, copies);
  };
  console.clear()
  console.log("📡 Listening for photo...");
}

startListener();