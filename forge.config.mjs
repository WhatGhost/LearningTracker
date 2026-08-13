export default {
  packagerConfig: {
    asar: true,
    executableName: "LearningTracker",
    electronZipDir: process.env.ELECTRON_ZIP_DIR || undefined,
    extraResource: [],
    ignore: [
      /^\/data(?:\/|$)/,
      /^\/out(?:\/|$)/,
      /^\/test(?:\/|$)/,
      /^\/\.git(?:\/|$)/,
    ],
  },
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "learning_tracker",
        authors: "Learning Tracker",
        description: "本地文章阅读清单",
        setupExe: "LearningTracker-Setup.exe",
      },
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: ["win32", "darwin", "linux"],
    },
  ],
};
