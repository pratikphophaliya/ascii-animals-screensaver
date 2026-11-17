// Builds the Microsoft Store package (dist/*.appx).
// The Partner Center identity lives in store-identity.json, which is git-ignored.
// Copy store-identity.example.json to store-identity.json and fill in the values from
// Partner Center > your app > Product management > Product identity.
const fs = require("fs");
const path = require("path");
const builder = require("electron-builder");

const root = path.join(__dirname, "..");
const identityFile = path.join(root, "store-identity.json");
if (!fs.existsSync(identityFile)) {
  console.error("Missing store-identity.json. Copy store-identity.example.json and fill in your Partner Center values.");
  process.exit(1);
}
const identity = JSON.parse(fs.readFileSync(identityFile, "utf8"));
const base = require(path.join(root, "package.json")).build;

builder
  .build({
    targets: builder.Platform.WINDOWS.createTarget("appx"),
    config: { ...base, appx: { ...base.appx, ...identity } },
    publish: "never",
  })
  .then((files) => console.log("Built:\n" + files.join("\n")))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
