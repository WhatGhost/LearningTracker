import asar from "@electron/asar";
import electronPath from "electron";
import electronWinstaller from "electron-winstaller";
import { createWriteStream } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZipFile } from "yazl";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outRoot = path.join(projectRoot, "out");
const appDirectory = path.join(outRoot, "LearningTracker-win32-x64");
const makeRoot = path.join(outRoot, "make");
const portableZip = path.join(makeRoot, "zip", "win32", "x64", "LearningTracker-win32-x64.zip");
const installerDirectory = path.join(makeRoot, "squirrel.windows", "x64");
const makeInstaller = process.argv.includes("--installer");

function assertGeneratedPath(target) {
  const resolvedOut = path.resolve(outRoot);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget !== resolvedOut && !resolvedTarget.startsWith(`${resolvedOut}${path.sep}`)) {
    throw new Error(`Refusing to modify a path outside out/: ${resolvedTarget}`);
  }
}

async function zipDirectory(input, output) {
  await mkdir(path.dirname(output), { recursive: true });
  await rm(output, { force: true });
  const archive = new ZipFile();
  const files = [];

  async function collect(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await collect(fullPath);
      else if (entry.isFile()) files.push(fullPath);
    }
  }

  await collect(input);
  for (const file of files) {
    const fileStat = await stat(file);
    archive.addFile(file, path.relative(path.dirname(input), file).replaceAll(path.sep, "/"), {
      mtime: fileStat.mtime,
      mode: fileStat.mode,
    });
  }

  await new Promise((resolve, reject) => {
    const stream = createWriteStream(output);
    stream.on("close", resolve);
    stream.on("error", reject);
    archive.outputStream.on("error", reject).pipe(stream);
    archive.end();
  });
}

async function createApplicationAsar() {
  const stage = await mkdtemp(path.join(os.tmpdir(), "learning-tracker-stage-"));
  try {
    const sourcePackage = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
    const runtimePackage = {
      name: sourcePackage.name,
      productName: "阅迹",
      version: sourcePackage.version,
      description: sourcePackage.description,
      author: sourcePackage.author,
      main: sourcePackage.main,
      type: sourcePackage.type,
    };
    await writeFile(path.join(stage, "package.json"), `${JSON.stringify(runtimePackage, null, 2)}\n`, "utf8");
    for (const entry of ["config", "electron", "lib", "public"]) {
      await cp(path.join(projectRoot, entry), path.join(stage, entry), { recursive: true });
    }
    await cp(path.join(projectRoot, "server.mjs"), path.join(stage, "server.mjs"));
    await asar.createPackage(stage, path.join(appDirectory, "resources", "app.asar"));
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

async function buildPortableApplication() {
  if (process.platform !== "win32") {
    throw new Error("This packaging script currently builds the Windows desktop release on Windows only.");
  }
  assertGeneratedPath(appDirectory);
  assertGeneratedPath(portableZip);
  await rm(appDirectory, { recursive: true, force: true });
  await mkdir(outRoot, { recursive: true });
  await cp(path.dirname(electronPath), appDirectory, { recursive: true });
  await rename(path.join(appDirectory, "electron.exe"), path.join(appDirectory, "LearningTracker.exe"));
  await rm(path.join(appDirectory, "resources", "default_app.asar"), { force: true });
  await createApplicationAsar();
  await zipDirectory(appDirectory, portableZip);
  console.log(`Portable app: ${appDirectory}`);
  console.log(`Portable ZIP: ${portableZip}`);
}

async function buildWindowsInstaller() {
  assertGeneratedPath(installerDirectory);
  await rm(installerDirectory, { recursive: true, force: true });
  await electronWinstaller.createWindowsInstaller({
    appDirectory,
    outputDirectory: installerDirectory,
    authors: "Learning Tracker",
    description: "本地优先的文章阅读清单",
    exe: "LearningTracker.exe",
    name: "learning_tracker",
    noMsi: true,
    setupExe: "LearningTracker-Setup.exe",
    title: "阅迹",
    version: "1.0.0",
  });
  console.log(`Windows installer: ${path.join(installerDirectory, "LearningTracker-Setup.exe")}`);
}

await buildPortableApplication();
if (makeInstaller) await buildWindowsInstaller();
