require("dotenv").config();

const axios = require("axios");
const fs = require("fs");
const path = require("path");
PORT = process.env.PORT
/*
|--------------------------------------------------------------------------
| Configuration
|--------------------------------------------------------------------------
*/

const SERVER_URL =
    process.env.SERVER_URL;

const FILE_API_KEY =
    process.env.FILE_API_KEY;

const DOWNLOAD_DIR =
    path.join(
        __dirname,
        "downloads"
    );

const FOLDERS = [
    "normal",
    "express",
    "cash"
];


/*
|--------------------------------------------------------------------------
| Validate configuration
|--------------------------------------------------------------------------
*/

if (!SERVER_URL) {

    console.error(
        "ERROR: SERVER_URL is missing in .env"
    );

    process.exit(1);
}

if (!FILE_API_KEY) {

    console.error(
        "ERROR: FILE_API_KEY is missing in .env"
    );

    process.exit(1);
}


/*
|--------------------------------------------------------------------------
| Axios configuration
|--------------------------------------------------------------------------
*/

const api = axios.create({

    baseURL: SERVER_URL,

    timeout: 10000,

    headers: {
        "X-API-Key": FILE_API_KEY
    }
});


/*
|--------------------------------------------------------------------------
| Create local folders
|--------------------------------------------------------------------------
*/

for (const folder of FOLDERS) {

    const folderPath =
        path.join(
            DOWNLOAD_DIR,
            folder
        );

    if (!fs.existsSync(folderPath)) {

        fs.mkdirSync(
            folderPath,
            {
                recursive: true
            }
        );
    }
}


/*
|--------------------------------------------------------------------------
| Check server
|--------------------------------------------------------------------------
*/

async function checkForNewFile() {

    try {

        const response =
            await api.get(
                "/api/files/next",
                {
                    validateStatus:
                        status =>
                            status === 200 ||
                            status === 204
                }
            );


        /*
        |--------------------------------------------------------------------------
        | No file
        |--------------------------------------------------------------------------
        */

        if (
            response.status === 204
        ) {

            console.log(
                `[${new Date().toLocaleTimeString()}] No new file`
            );

            return;
        }


        /*
        |--------------------------------------------------------------------------
        | File found
        |--------------------------------------------------------------------------
        */

        const file =
            response.data.file;

        console.log("");
        console.log(
            "================================"
        );

        console.log(
            "NEW FILE FOUND"
        );

        console.log(
            "Folder:",
            file.folder
        );

        console.log(
            "File:",
            file.name
        );

        console.log(
            "Size:",
            file.size,
            "bytes"
        );

        console.log(
            "================================"
        );


        await downloadFile(file);

    } catch (error) {

        if (
            error.response?.status === 401
        ) {

            console.error(
                "AUTHENTICATION FAILED:"
            );

            console.error(
                "Invalid or missing FILE_API_KEY."
            );

            return;
        }


        if (error.response) {

            console.error(
                "Server error:",
                error.response.status,
                error.response.data
            );

        } else {

            console.error(
                "Connection error:",
                error.message
            );
        }
    }
}


/*
|--------------------------------------------------------------------------
| Download file
|--------------------------------------------------------------------------
*/

async function downloadFile(file) {

    const folder =
        file.folder;

    const filename =
        path.basename(
            file.name
        );


    /*
    |--------------------------------------------------------------------------
    | Local folder
    |--------------------------------------------------------------------------
    */

    const localFolder =
        path.join(
            DOWNLOAD_DIR,
            folder
        );


    if (!fs.existsSync(localFolder)) {

        fs.mkdirSync(
            localFolder,
            {
                recursive: true
            }
        );
    }


    /*
    |--------------------------------------------------------------------------
    | Final path
    |--------------------------------------------------------------------------
    */

    const finalPath =
        path.join(
            localFolder,
            filename
        );


    /*
    |--------------------------------------------------------------------------
    | Temporary file
    |--------------------------------------------------------------------------
    */

    const tempPath =
        finalPath +
        ".downloading";


    try {

        console.log(
            `Downloading ${folder}/${filename}`
        );


        const response =
            await api.get(

                `/api/files/download/` +
                `${encodeURIComponent(folder)}/` +
                `${encodeURIComponent(filename)}`,

                {
                    responseType: "stream",

                    timeout: 120000
                }
            );


        /*
        |--------------------------------------------------------------------------
        | Write file
        |--------------------------------------------------------------------------
        */

        const writer =
            fs.createWriteStream(
                tempPath
            );


        let downloadedBytes = 0;


        response.data.on(
            "data",
            chunk => {

                downloadedBytes +=
                    chunk.length;


                if (file.size > 0) {

                    const percentage =
                        (
                            downloadedBytes /
                            file.size *
                            100
                        ).toFixed(1);


                    process.stdout.write(
                        `\rDownloading ${folder}/${filename}: ${percentage}%`
                    );
                }
            }
        );


        /*
        |--------------------------------------------------------------------------
        | Wait for download completion
        |--------------------------------------------------------------------------
        */

        await new Promise(
            (resolve, reject) => {

                response.data.pipe(
                    writer
                );


                writer.on(
                    "finish",
                    resolve
                );


                writer.on(
                    "error",
                    reject
                );


                response.data.on(
                    "error",
                    reject
                );
            }
        );


        console.log("");


        /*
        |--------------------------------------------------------------------------
        | Verify size
        |--------------------------------------------------------------------------
        */

        const stats =
            fs.statSync(
                tempPath
            );


        if (
            stats.size !== file.size
        ) {

            throw new Error(
                `File size mismatch. Expected ${file.size}, received ${stats.size}`
            );
        }


        /*
        |--------------------------------------------------------------------------
        | Rename
        |--------------------------------------------------------------------------
        */

        fs.renameSync(
            tempPath,
            finalPath
        );


        console.log(
            "Download completed:"
        );

        console.log(
            finalPath
        );


        /*
        |--------------------------------------------------------------------------
        | ACK
        |--------------------------------------------------------------------------
        */

        await acknowledgeFile(
            folder,
            filename
        );

    } catch (error) {

        console.error(
            "\nDownload failed:",
            error.message
        );


        /*
        |--------------------------------------------------------------------------
        | Delete incomplete download
        |--------------------------------------------------------------------------
        */

        if (
            fs.existsSync(tempPath)
        ) {

            try {

                fs.unlinkSync(
                    tempPath
                );

            } catch {}
        }


        console.log(
            "File remains on server."
        );

        console.log(
            "It will be retried."
        );
    }
}


/*
|--------------------------------------------------------------------------
| ACK server
|--------------------------------------------------------------------------
*/

async function acknowledgeFile(
    folder,
    filename
) {

    try {

        const response =
            await api.post(
                "/api/files/ack",
                {
                    folder,
                    filename
                }
            );


        console.log(
            "Server:",
            response.data.message
        );

    } catch (error) {

        if (
            error.response?.status === 401
        ) {

            console.error(
                "ACK authentication failed."
            );

        } else {

            console.error(
                "ACK failed:",
                error.message
            );
        }


        console.log(
            "Server file was NOT deleted."
        );

        console.log(
            "Local file is safe."
        );
    }
}


/*
|--------------------------------------------------------------------------
| Polling
|--------------------------------------------------------------------------
*/

let isChecking = false;


async function pollServer() {

    if (isChecking) {
        return;
    }


    isChecking = true;


    try {

        await checkForNewFile();

    } finally {

        isChecking = false;
    }
}


/*
|--------------------------------------------------------------------------
| Start
|--------------------------------------------------------------------------
*/

console.log(
    "================================"
);

console.log(
    "Automatic File Downloader"
);

console.log(
    "================================"
);

console.log(
    "Server:",
    SERVER_URL
);

console.log(
    "Download directory:",
    DOWNLOAD_DIR
);

console.log(
    "API authentication: ENABLED"
);

console.log(
    "================================"
);


/*
|--------------------------------------------------------------------------
| First check
|--------------------------------------------------------------------------
*/

pollServer();


/*
|--------------------------------------------------------------------------
| Poll every 5 seconds
|--------------------------------------------------------------------------
*/

setInterval(
    pollServer,
    PORT
);
