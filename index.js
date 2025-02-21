import { Command } from "commander";
import fs from "fs";
import path, { resolve } from "path";
import archiver from "archiver";
import express from "express";
import FormData from "form-data";
import { exec } from "node:child_process";

// Authentication

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

app.get("/", async (req, res) => {
    res.redirect(
        `https://developer.api.autodesk.com/authentication/v2/authorize?response_type=code&client_id=${config.credentials.clientId}&redirect_uri=http://localhost:8080/callback&scope=${config.credentials.scope}`
    );
});

app.get("/callback", async (req, res) => {
    const { code } = req.query;
    try {
        let token = await fetch(
            "https://developer.api.autodesk.com/authentication/v2/token",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: `client_id=${config.credentials.clientId}&client_secret=${config.credentials.clientSecret}&grant_type=authorization_code&code=${code}&redirect_uri=http://localhost:${PORT}/callback`,
            }
        );

        let tokenData = await token.json();
        tokenData.expires_at = tokenData.expires_in * 1000 + Date.now();

        let info = await fetch(
            "https://api.userprofile.autodesk.com/userinfo",
            {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${tokenData.access_token}`,
                },
            }
        );

        let infoData = await info.json();

        tokenData.email = infoData.email;
        tokenData.oxygenId = infoData.sub;

        fs.writeFileSync(
            `./token.json`,
            JSON.stringify(tokenData, null, 2),
            "utf8"
        );

        res.status(200).send("Saved access token in token.json!");

        process.exit(0);
    } catch (error) {
        res.status(500).send("Error getting 3-legged access token");
    }
});

function getAccessToken2LO() {
    return new Promise(async (resolve, reject) => {
        let token = await fetch(
            "https://developer.api.autodesk.com/authentication/v2/token",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: `client_id=${config.credentials.clientId}&client_secret=${config.credentials.clientSecret}&grant_type=client_credentials&scope=${config.credentials.scope}`,
            }
        );

        let tokenData = await token.json();
        console.log(tokenData);

        resolve(tokenData.access_token);
    });
}

function getAccessToken3LO() {
    try {
        const token = JSON.parse(fs.readFileSync(`./token.json`, "utf8"));

        if (token.expires_at < Date.now()) {
            console.error(
                `Token expired. Please log in again at http://localhost:${PORT}`
            );
            throw { message: "Need to log in again", quit: false };
        }

        if (!token.access_token) {
            console.error(
                `No token available. Please log in agan at http://localhost:${PORT}`
            );
            throw { message: "Need to log in again", quit: false };
        }

        return token.access_token;
    } catch {
        console.error(
            `No token available. Please log in at http://localhost:${PORT}`
        );
        throw { message: "Need to log in", quit: false };
    }
}

// Command Line

const program = new Command();

program
    .version("1.0.0")
    .description(
        "A simple CLI application to help with Design Automation API tasks"
    )
    .option("-t, --token", "Create 3-legged token")
    .option("-e, --engines", "List available engines")
    .option("-b, --bundle", "Update app bundle")
    .option("-a, --activity", "Update activity")
    .option("-w, --workitem", "Run work item")
    .option("-d, --delete", "Delete app")
    .option("-p, --patch", "Patch app to set nickname and public key")
    .option("-k, --key", "Create public and private keys (Windows Only)")
    .option("-s, --sign", "Sign activity with (Windows Only)")
    .option("-c, --config <name>", "Config file to use");

program.parse(process.argv);

const options = program.opts();

if (!options.config) {
    console.error("No config json file specified");
    process.exit(1);
}

const config = JSON.parse(fs.readFileSync(`./${options.config}`, "utf8"));

const globals = {};
globals.nickname = config.nickname;
globals.bucketName = config.bucketName;
globals.accessToken2LO = await getAccessToken2LO();
if (!globals.accessToken2LO) {
    console.error("Could not fetch 2-legged access token");
    process.exit(1);
}

if (options.key || options.sign) {
    if (process.platform !== "win32") {
        console.error(
            "-key and -sign only works on Windows, because it requires Das.WorkItemSigner.exe"
        );
        process.exit(1);
    }

    if (!fs.existsSync("./Das.WorkItemSigner.exe")) {
        console.error(
            "You have to download Das.WorkItemSigner.exe from https://github.com/autodesk-platform-services/aps-designautomation-signer/releases/ and provide the path to it in the root of the project"
        );
        process.exit(1);
    }
}

const execAsync = (command) => {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(stdout);
                console.error(stderr);
                error.quit = true;
                reject(error);
                return;
            }

            resolve(stdout);
        });
    });
};

if (options.token) {
    console.log("Log in at http://localhost:8080");
}

if (options.key) {
    await execAsync(`Das.WorkItemSigner.exe generate mykey.json`);

    await execAsync(
        `Das.WorkItemSigner.exe export mykey.json mypublickey.json`
    );

    console.log(
        "Generated public and private key files, mypublickey.json and mykey.json"
    );
}

if (options.sign) {
    const activityId = `${config.nickname}.${config.activity.id}+${config.activity.alias}`;
    config.activity.signedId = await execAsync(
        `Das.WorkItemSigner.exe sign mykey.json ${activityId}`
    );
    config.activity.signedId = config.activity.signedId.replace(
        /(\r\n|\n|\r)/gm,
        ""
    );

    fs.writeFileSync(
        `./${options.config}`,
        JSON.stringify(config, null, 2),
        "utf8"
    );

    console.log(`Signed activity with id: ${config.activity.signedId}`);
}

if (options.delete) {
    console.log("Deleting app");

    await deleteApp();
}

if (options.patch) {
    console.log("Patching app");

    await patchApp();
}

if (options.engines) {
    await listEngines();
}

if (options.bundle) {
    console.log(`Updating app bundle ${config.appbundle.id}`);

    try {
        await zipFolder(config.appbundle.path, "appbundle.zip");

        await createUpdateAppBundle();

        console.log("App bundle updated");
    } catch (error) {
        console.error(error.message);
        if (error.quit) process.exit(1);
    }
}

if (options.activity) {
    console.log(`Updating activity ${config.activity.id}`);

    try {
        await createUpdateActivity();

        console.log("Activity updated");
    } catch (error) {
        console.error(error.message);
        if (error.quit) process.exit(1);
    }
}

if (options.workitem) {
    console.log(`Starting work item for activity ${config.activity.id}`);

    try {
        await runWorkItem();
        process.exit(0);
    } catch (error) {
        console.error("Error running work item");
        if (error.quit) process.exit(1);
    }
}

if (!options.token) {
    process.exit(0);
}

// Engines

async function listEngines() {
    let page = null;
    do {
        let res = await fetch(
            `https://developer.api.autodesk.com/da/us-east/v3/engines${page ? `?page=${page}` : ""}`,
            {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${globals.accessToken2LO}`,
                },
            }
        );

        if (res.status !== 200) {
            console.error("Error listing engines: " + res.statusText);
            return;
        }

        let data = await res.json();
        console.log(JSON.stringify(data.data, null, 2));

        page = data.paginationToken;
    } while (page);
}

// Account

async function deleteApp() {
    try {
        let res = await fetch(
            "https://developer.api.autodesk.com/da/us-east/v3/forgeapps/me",
            {
                method: "DELETE",
                headers: {
                    Authorization: `Bearer ${globals.accessToken2LO}`,
                },
            }
        );

        let data = await res.text();

        if (![200, 204].includes(res.status)) {
            throw {
                message: "Error deleting app: " + res.statusText,
                quit: true,
            };
        }

        console.log("App deleted");
    } catch (error) {
        console.error(error);
    }
}

async function patchApp() {
    const body = {
        nickname: config.nickname,
    };

    let publicKeyPath = "./mypublickey.json";
    if (fs.existsSync(publicKeyPath)) {
        const publicKeyContent = JSON.parse(
            fs.readFileSync(publicKeyPath, "utf8")
        );
        body.publicKey = publicKeyContent;
        console.log("Setting nickname and public key");
    } else {
        console.log(
            "Only setting nickname, since `mypublickey.json` is not found in project root."
        );
    }

    try {
        let res = await fetch(
            "https://developer.api.autodesk.com/da/us-east/v3/forgeapps/me",
            {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${globals.accessToken2LO}`,
                },
                body: JSON.stringify(body),
            }
        );

        if (res.status !== 200) {
            throw {
                message: "Error patching app: " + res.statusText,
                quit: true,
            };
        }

        console.log("App updated");
    } catch (error) {
        console.error(error);
    }
}

// App Bundles

async function uploadAppBundle(uploadParameters) {
    const form = new FormData();
    for (const [key, value] of Object.entries(uploadParameters.formData)) {
        form.append(key, value);
        console.log(key, value);
    }

    form.append("file", fs.readFileSync("appbundle.zip"));

    // This seems to be needed (cannot pass `form` as input for `body`) but it only works if NOT using
    // form.append("file", fs.createReadStream("appbundle.zip"));
    const buffer = form.getBuffer();

    try {
        const res = await fetch(uploadParameters.endpointURL, {
            method: "POST",
            headers: form.getHeaders(),
            body: buffer,
        });
        console.log(await res.text());
    } catch (error) {
        console.error(error);
        throw { message: "Error uploading app bundle", quit: true };
    }
}

function createUpdateAppBundle() {
    console.log("Creating app bundle");

    return new Promise(async (resolve, reject) => {
        let appBundle = await fetch(
            "https://developer.api.autodesk.com/da/us-east/v3/appbundles",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${globals.accessToken2LO}`,
                },
                body: JSON.stringify({
                    id: config.appbundle.id,
                    engine: config.appbundle.engine,
                    description: config.appbundle.description,
                }),
            }
        );

        let appBundleData = await appBundle.json();
        console.log(appBundleData);

        if (appBundle.status === 409) {
            // If it already exists create new version instead
            appBundle = await fetch(
                `https://developer.api.autodesk.com/da/us-east/v3/appbundles/${config.appbundle.id}/versions`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${globals.accessToken2LO}`,
                    },
                    body: JSON.stringify({
                        engine: config.appbundle.engine,
                        description: config.appbundle.description,
                    }),
                }
            );

            appBundleData = await appBundle.json();
            console.log(appBundleData);
        }

        if (appBundle.status !== 200)
            reject({ message: appBundle.message, quit: true });

        await uploadAppBundle(appBundleData.uploadParameters);

        let alias = await fetch(
            `https://developer.api.autodesk.com/da/us-east/v3/appbundles/${config.appbundle.id}/aliases`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${globals.accessToken2LO}`,
                },
                body: JSON.stringify({
                    id: config.appbundle.alias,
                    version: appBundleData.version,
                }),
            }
        );

        let aliasData = await alias.json();
        console.log(aliasData);

        if (alias.status === 409) {
            // If it already exists create new version instead
            alias = await fetch(
                `https://developer.api.autodesk.com/da/us-east/v3/appbundles/${config.appbundle.id}/aliases/${config.appbundle.alias}`,
                {
                    method: "PATCH",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${globals.accessToken2LO}`,
                    },
                    body: JSON.stringify({
                        version: appBundleData.version,
                    }),
                }
            );

            aliasData = await alias.json();
            console.log(aliasData);
        }

        if (alias.status !== 200)
            reject({ message: alias.message, quit: true });

        resolve(true);
    });
}

// Activities

function createUpdateActivity() {
    console.log("Creating activity");

    let appbundles = config.activity.appbundles;
    for (let key in appbundles) {
        appbundles[key] = replaceFromGlobals(appbundles[key]);
    }

    return new Promise(async (resolve, reject) => {
        let activity = await fetch(
            "https://developer.api.autodesk.com/da/us-east/v3/activities",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${globals.accessToken2LO}`,
                },
                body: JSON.stringify({
                    id: config.activity.id,
                    engine: config.activity.engine,
                    description: config.activity.description,
                    appbundles: appbundles,
                    commandLine: config.activity.commandLine,
                    parameters: config.activity.parameters,
                }),
            }
        );

        let activityData = await activity.json();
        console.log(activityData);

        if (activity.status === 409) {
            // If it already exists create new version instead
            activity = await fetch(
                `https://developer.api.autodesk.com/da/us-east/v3/activities/${config.activity.id}/versions`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${globals.accessToken2LO}`,
                    },
                    body: JSON.stringify({
                        engine: config.activity.engine,
                        description: config.activity.description,
                        appbundles: config.activity.appbundles,
                        commandLine: config.activity.commandLine,
                        parameters: config.activity.parameters,
                    }),
                }
            );

            activityData = await activity.json();
            console.log(activityData);
        }

        if (activity.status !== 200)
            reject({ message: activity.message, quit: true });

        let alias = await fetch(
            `https://developer.api.autodesk.com/da/us-east/v3/activities/${config.appbundle.id}/aliases`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${globals.accessToken2LO}`,
                },
                body: JSON.stringify({
                    version: activityData.version,
                    id: config.activity.alias,
                }),
            }
        );

        let aliasData = await alias.json();
        console.log(aliasData);

        if (alias.status === 409) {
            // If it already exists create new version instead
            alias = await fetch(
                `https://developer.api.autodesk.com/da/us-east/v3/activities/${config.appbundle.id}/aliases/${config.appbundle.alias}`,
                {
                    method: "PATCH",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${globals.accessToken2LO}`,
                    },
                    body: JSON.stringify({
                        version: activityData.version,
                    }),
                }
            );

            aliasData = await alias.json();
            console.log(aliasData);
        }

        if (alias.status !== 200)
            reject({ message: alias.message, quit: true });

        resolve(true);
    });
}

function runWorkItem() {
    console.log("Starting work item");

    return new Promise(async (resolve, reject) => {
        let authorizationHeader = `Bearer ${globals.accessToken2LO}`;
        let signatures = null;

        if (config.activity.signedId) {
            console.log(
                "Using signed activity because `signedId` is set in config file"
            );
            globals.accessToken3LO = null;
            try {
                console.log("Using 3-legged access token");
                globals.accessToken3LO = await getAccessToken3LO();
            } catch {
                console.error("Could not fetch 3-legged access token");
                reject({
                    message: "Error getting 3-legged access token",
                    quit: false,
                });
                return;
            }

            authorizationHeader = `Bearer ${globals.accessToken3LO}`;
            signatures = {
                activityId: config.activity.signedId,
            };
        }

        const items = await modifyWorkItemBody(config.workitem.arguments);

        let body = JSON.stringify({
            activityId: `${config.nickname}.${config.activity.id}+${config.activity.alias}`,
            signatures,
            arguments: items,
        });
        console.log(body);

        let workitem = await fetch(
            "https://developer.api.autodesk.com/da/us-east/v3/workitems",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: authorizationHeader,
                },
                body,
            }
        );

        let workitemData = await workitem.json();
        console.log(JSON.stringify(workitemData, null, 2));

        if (!workitemData.id) {
            reject({ message: "Error creating work item", quit: true });
            return;
        }

        while (true) {
            workitem = await fetch(
                `https://developer.api.autodesk.com/da/us-east/v3/workitems/${workitemData.id}`,
                {
                    method: "GET",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${globals.accessToken2LO}`,
                    },
                }
            );

            workitemData = await workitem.json();
            console.log(workitemData);

            if (workitemData.status.includes("failed")) {
                await saveReport(workitemData);
                reject({ message: "Work item failed", quit: true });
                return;
            }

            if (workitemData.status === "success") {
                await saveReport(workitemData);
                resolve(true);
                return;
            }

            await new Promise((resolve) => setTimeout(resolve, 2000));
        }
    });
}

// Utils

function getSignedURL(bucketKey, objectName) {
    return new Promise(async (resolve, reject) => {
        let signedUrl = await fetch(
            `https://developer.api.autodesk.com/oss/v2/buckets/${bucketKey}/objects/${objectName}/signed?access=readwrite`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${globals.accessToken2LO}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    minutesExpiration: 60,
                }),
            }
        );

        let signedUrlData = await signedUrl.json();
        console.log(signedUrlData);

        resolve(signedUrlData.signedUrl);
    });
}

async function saveReport(workitemData) {
    console.log("Work item report: " + workitemData.reportUrl);
    try {
        let res = await fetch(workitemData.reportUrl);
        const text = await res.text();
        if (!fs.existsSync("./reports")) fs.mkdirSync("./reports");

        let fileName = `./reports/${workitemData.id}.txt`
        fs.writeFileSync(fileName, text, {
            encoding: "utf8",
            flag: "w",
        });

        console.log("Report saved as " + fileName);
    } catch (error) {
        console.error(error.message);
    }
}

function replaceFromGlobals(str) {
    const regex = /{{(.*?)}}/g;
    const result = str.replace(regex, (_, variable) => globals[variable]);
    return result;
}

async function modifyWorkItemBody(items) {
    for (const [key, value] of Object.entries(items)) {
        if (value?.url?.startsWith("urn:")) {
            value.url = replaceFromGlobals(value.url);
        }

        if (value?.headers?.Authorization) {
            value.headers.Authorization = replaceFromGlobals(
                value.headers.Authorization
            );
            continue;
        }

        if (value?.url?.startsWith("urn:")) {
            const [bucketKey, objectName] = value.url.split(":")[3].split("/");
            const signedUrl = await getSignedURL(bucketKey, objectName);
            value.url = signedUrl;
        }
    }

    return items;
}

// Zipping

function zipFolder(source, out) {
    const archive = archiver("zip", { zlib: { level: 9 } });
    const stream = fs.createWriteStream(out);

    return new Promise((resolve, reject) => {
        if (!fs.existsSync(source)) {
            reject({ message: `Folder ${source} does not exist`, quit: true });
            return;
        }

        archive
            .directory(source, path.basename(source))
            .on("error", (error) => reject(error))
            .pipe(stream);

        stream.on("close", () => resolve());
        archive.finalize();
    });
}
