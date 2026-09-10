/*
|--------------------------------------------------------------------------
| server.js
|--------------------------------------------------------------------------
| UniKart Printer Client
|--------------------------------------------------------------------------
*/

require("dotenv").config();

const axios = require("axios");

const fs = require("fs");

const path = require("path");

const crypto = require("crypto");

const express = require("express");

const {
    execFile
} = require("child_process");

const {
    promisify
} = require("util");

const PDFDocument = require("pdfkit");


const {
    connectDatabase,
    createPrintJob,
    getPendingJobs,
    getProcessingJob,
    updateJobStatus,
    setCupsJobId
} = require("./database");


const dashboard =
    require("./dashboard");


const execFileAsync =
    promisify(execFile);


/*
|--------------------------------------------------------------------------
| Configuration
|--------------------------------------------------------------------------
*/

const PORT =
    Number(process.env.PORT) || 3000;


const SERVER_URL =
    process.env.SERVER_URL;


const FILE_API_KEY =
    process.env.FILE_API_KEY;


const POLL_INTERVAL =
    Number(
        process.env.POLL_INTERVAL
    ) || 5000;


const PRINTER_NAME =
    process.env.PRINTER_NAME ||
    "Brother_DCP_T530DW";


const DOWNLOAD_DIR =
    path.resolve(
        process.env.DOWNLOAD_DIR ||
        "./downloads"
    );


const FOLDERS = [
    "normal",
    "express",
    "cash"
];


/*
|--------------------------------------------------------------------------
| Express
|--------------------------------------------------------------------------
*/

const app =
    express();


app.use(
    express.json()
);


/*
|--------------------------------------------------------------------------
| Dashboard
|--------------------------------------------------------------------------
*/

app.use(
    "/dashboard",
    dashboard
);


/*
|--------------------------------------------------------------------------
| Validate configuration
|--------------------------------------------------------------------------
*/

if (!SERVER_URL) {

    console.error(
        "SERVER_URL missing"
    );

    process.exit(1);
}


if (!FILE_API_KEY) {

    console.error(
        "FILE_API_KEY missing"
    );

    process.exit(1);
}


/*
|--------------------------------------------------------------------------
| Axios
|--------------------------------------------------------------------------
*/

const api =
    axios.create({

        baseURL:
            SERVER_URL,

        timeout:
            10000,

        headers: {

            "X-API-Key":
                FILE_API_KEY
        }

    });


/*
|--------------------------------------------------------------------------
| Create directories
|--------------------------------------------------------------------------
*/

for (
    const folder of FOLDERS
) {

    fs.mkdirSync(

        path.join(
            DOWNLOAD_DIR,
            folder
        ),

        {
            recursive: true
        }

    );
}


/*
|--------------------------------------------------------------------------
| Convert directories
|--------------------------------------------------------------------------
*/

const TEMP_DIR =
    path.resolve("./temp");


fs.mkdirSync(
    TEMP_DIR,
    {
        recursive: true
    }
);


/*
|--------------------------------------------------------------------------
| Download server file
|--------------------------------------------------------------------------
*/

async function downloadFile(file) {

    const folder =
        file.folder;


    const originalFilename =
        path.basename(
            file.name
        );


    const extension =
        path.extname(
            originalFilename
        )
        .toLowerCase();


    const safeBaseName =
        path.basename(
            originalFilename,
            extension
        )
        .replace(
            /[^a-zA-Z0-9_-]/g,
            "-"
        );


    /*
    |--------------------------------------------------------------------------
    | Temporary downloaded file
    |--------------------------------------------------------------------------
    */

    const tempPath =
        path.join(

            TEMP_DIR,

            `${Date.now()}-${safeBaseName}${extension}`

        );


    try {

        console.log("");
        console.log(
            "================================"
        );

        console.log(
            "DOWNLOADING FILE"
        );

        console.log(
            "Folder:",
            folder
        );

        console.log(
            "File:",
            originalFilename
        );

        console.log(
            "================================"
        );


        const response =
            await api.get(

                `/api/files/download/` +
                `${encodeURIComponent(folder)}/` +
                `${encodeURIComponent(originalFilename)}`,

                {
                    responseType:
                        "stream",

                    timeout:
                        120000
                }

            );


        const writer =
            fs.createWriteStream(
                tempPath
            );


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


        /*
        |--------------------------------------------------------------------------
        | Convert to PDF
        |--------------------------------------------------------------------------
        */

        const pdfPath =
            await ensurePdf(
                tempPath,
                originalFilename,
                folder
            );


        /*
        |--------------------------------------------------------------------------
        | Delete temporary original
        |--------------------------------------------------------------------------
        */

        if (
            fs.existsSync(tempPath)
        ) {

            fs.unlinkSync(
                tempPath
            );
        }


        /*
        |--------------------------------------------------------------------------
        | Save PDF in correct folder
        |--------------------------------------------------------------------------
        */

        const finalFilename =
            path.basename(
                pdfPath
            );


        const finalFolder =
            path.join(
                DOWNLOAD_DIR,
                folder
            );


        fs.mkdirSync(
            finalFolder,
            {
                recursive: true
            }
        );


        const finalPath =
            path.join(
                finalFolder,
                finalFilename
            );


        fs.copyFileSync(
            pdfPath,
            finalPath
        );


        /*
        |--------------------------------------------------------------------------
        | Remove converted temporary PDF
        |--------------------------------------------------------------------------
        */

        if (
            pdfPath !== finalPath &&
            fs.existsSync(pdfPath)
        ) {

            fs.unlinkSync(
                pdfPath
            );
        }


        /*
        |--------------------------------------------------------------------------
        | Local file size
        |--------------------------------------------------------------------------
        */

        const stats =
            fs.statSync(
                finalPath
            );


        console.log(
            "PDF saved:"
        );

        console.log(
            finalPath
        );


        /*
        |--------------------------------------------------------------------------
        | ACK server
        |--------------------------------------------------------------------------
        */

        await acknowledgeFile(
            folder,
            originalFilename
        );


        return {

            localPath:
                finalPath,

            size:
                stats.size,

            originalName:
                originalFilename,

            pdfName:
                finalFilename
        };


    } catch (error) {

        if (
            fs.existsSync(
                tempPath
            )
        ) {

            try {
                fs.unlinkSync(
                    tempPath
                );
            } catch {}
        }


        throw error;
    }
}


/*
|--------------------------------------------------------------------------
| Ensure PDF
|--------------------------------------------------------------------------
*/

async function ensurePdf(
    inputPath,
    originalName,
    folder
) {

    const extension =
        path.extname(
            originalName
        )
        .toLowerCase();


    /*
    |--------------------------------------------------------------------------
    | Already PDF
    |--------------------------------------------------------------------------
    */

    if (
        extension === ".pdf"
    ) {

        return inputPath;
    }


    /*
    |--------------------------------------------------------------------------
    | Images
    |--------------------------------------------------------------------------
    */

    const imageExtensions = [

        ".jpg",
        ".jpeg",
        ".png",
        ".bmp",
        ".webp"

    ];


    if (
        imageExtensions.includes(
            extension
        )
    ) {

        return await imageToPdf(
            inputPath,
            originalName
        );
    }


    /*
    |--------------------------------------------------------------------------
    | Everything else
    |--------------------------------------------------------------------------
    |
    | DOC
    | DOCX
    | XLS
    | XLSX
    | PPT
    | PPTX
    | ODT
    | etc.
    |
    */

    return await libreOfficeToPdf(
        inputPath
    );
}


/*
|--------------------------------------------------------------------------
| Image → PDF
|--------------------------------------------------------------------------
*/

async function imageToPdf(
    imagePath,
    originalName
) {

    const baseName =
        path.basename(
            originalName,
            path.extname(
                originalName
            )
        );


    const outputPath =
        path.join(

            TEMP_DIR,

            `${Date.now()}-${baseName}.pdf`

        );


    return await new Promise(
        (resolve, reject) => {

            const doc =
                new PDFDocument({
                    autoFirstPage:
                        false
                });


            const stream =
                fs.createWriteStream(
                    outputPath
                );


            doc.pipe(stream);


            /*
            |--------------------------------------------------------------
            | Add image to PDF
            |--------------------------------------------------------------
            */

            doc.addPage();


            doc.image(
                imagePath,
                0,
                0,
                {
                    fit: [
                        595,
                        842
                    ],

                    align:
                        "center",

                    valign:
                        "center"
                }
            );


            doc.end();


            stream.on(
                "finish",
                () => {

                    resolve(
                        outputPath
                    );
                }
            );


            stream.on(
                "error",
                reject
            );

        }
    );
}


/*
|--------------------------------------------------------------------------
| LibreOffice conversion
|--------------------------------------------------------------------------
*/

async function libreOfficeToPdf(
    inputPath
) {

    const outputDirectory =
        TEMP_DIR;


    await execFileAsync(

        "libreoffice",

        [

            "--headless",

            "--convert-to",
            "pdf",

            "--outdir",
            outputDirectory,

            inputPath

        ],

        {
            timeout:
                120000
        }

    );


    const inputBaseName =
        path.basename(
            inputPath,
            path.extname(
                inputPath
            )
        );


    const outputPath =
        path.join(

            outputDirectory,

            `${inputBaseName}.pdf`

        );


    if (
        !fs.existsSync(
            outputPath
        )
    ) {

        throw new Error(
            "LibreOffice failed to create PDF"
        );
    }


    return outputPath;
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

    const response =
        await api.post(
            "/api/files/ack",

            {
                folder,
                filename
            }
        );


    console.log(
        "Server ACK:",
        response.data.message
    );
}


/*
|--------------------------------------------------------------------------
| Fetch next file
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


        if (
            response.status === 204
        ) {

            return false;
        }


        const file =
            response.data.file;


        if (!file) {

            return false;
        }


        console.log(
            "New file:",
            file.name
        );


        /*
        |--------------------------------------------------------------------------
        | Download + convert
        |--------------------------------------------------------------------------
        */

        const downloaded =
            await downloadFile(
                file
            );


        /*
        |--------------------------------------------------------------------------
        | Database information
        |--------------------------------------------------------------------------
        */

        const jobId =
            file.jobId ||
            file._id ||
            crypto.randomUUID();


        /*
        |--------------------------------------------------------------------------
        | Express priority
        |--------------------------------------------------------------------------
        */

        let priority = 0;


        if (
            file.folder ===
            "express"
        ) {

            priority = 100;
        }


        /*
        |--------------------------------------------------------------------------
        | Create database job
        |--------------------------------------------------------------------------
        */

        const job =
            await createPrintJob({

                _id:
                    jobId,

                userId:
                    file.userId ||
                    file.user?.id ||
                    "unknown",

                orderId:
                    file.orderId,

                originalName:
                    file.originalName ||
                    downloaded.originalName,

                localFile:
                    downloaded.localPath,

                file:
                    file.url ||
                    file.file ||
                    file.documentUrl,

                size:
                    downloaded.size,

                options:
                    file.options ||
                    {},

                folder:
                    file.folder,

                priority,

                status:
                    "pending"

            });


        console.log("");
        console.log(
            "PRINT JOB CREATED"
        );

        console.log(
            "Job ID:",
            job._id
        );

        console.log(
            "Priority:",
            job.priority
        );

        console.log(
            "Status:",
            job.status
        );


        /*
        |--------------------------------------------------------------------------
        | Try to print
        |--------------------------------------------------------------------------
        */

        await processQueue();


        return true;


    } catch (error) {

        console.error(
            "File processing error:",
            error.message
        );

        return false;
    }
}


/*
|--------------------------------------------------------------------------
| Queue processor
|--------------------------------------------------------------------------
*/

let queueProcessing =
    false;


async function processQueue() {

    if (
        queueProcessing
    ) {

        return;
    }


    /*
    |--------------------------------------------------------------------------
    | Check whether something is already printing
    |--------------------------------------------------------------------------
    */

    const current =
        await getProcessingJob();


    if (current) {

        return;
    }


    queueProcessing = true;


    try {

        const jobs =
            await getPendingJobs();


        if (
            jobs.length === 0
        ) {

            return;
        }


        /*
        |--------------------------------------------------------------------------
        | First job according to priority/FIFO
        |--------------------------------------------------------------------------
        */

        const job =
            jobs[0];


        console.log("");
        console.log(
            "================================"
        );

        console.log(
            "STARTING PRINT JOB"
        );

        console.log(
            "Job:",
            job._id
        );

        console.log(
            "File:",
            job.originalName
        );

        console.log(
            "Folder:",
            job.folder
        );

        console.log(
            "================================"
        );


        /*
        |--------------------------------------------------------------------------
        | Mark processing
        |--------------------------------------------------------------------------
        */

        await updateJobStatus(
            job._id,
            "processing"
        );


        /*
        |--------------------------------------------------------------------------
        | Print
        |--------------------------------------------------------------------------
        */

        await printJob(
            job
        );


    } catch (error) {

        console.error(
            "Queue error:",
            error.message
        );

    } finally {

        queueProcessing =
            false;
    }
}


/*
|--------------------------------------------------------------------------
| Print using CUPS
|--------------------------------------------------------------------------
*/

async function printJob(job) {

    try {

        const options =
            job.options || {};


        const copies =
            Number(
                options.copies
            ) || 1;


        /*
        |--------------------------------------------------------------------------
        | Build CUPS arguments
        |--------------------------------------------------------------------------
        */

        const args = [

            "-d",
            PRINTER_NAME,

            "-o",
            `copies=${copies}`,

            "-o",
            `PageSize=${options.paperSize || "A4"}`

        ];


        /*
        |--------------------------------------------------------------------------
        | Black & White
        |--------------------------------------------------------------------------
        */

        if (
            options.color ===
            "monochrome" ||

            options.printingType ===
            "B&W"
        ) {

            args.push(
                "-o",
                "ColorModel=Gray"
            );
        }


        /*
        |--------------------------------------------------------------------------
        | Duplex
        |--------------------------------------------------------------------------
        */

        if (
            options.duplex === true
        ) {

            args.push(
                "-o",
                "Duplex=DuplexNoTumble"
            );
        }


        /*
        |--------------------------------------------------------------------------
        | Media type
        |--------------------------------------------------------------------------
        */

        if (
            options.mediaType
        ) {

            args.push(
                "-o",
                `MediaType=${options.mediaType}`
            );
        }


        /*
        |--------------------------------------------------------------------------
        | Filename
        |--------------------------------------------------------------------------
        */

        args.push(
            job.localFile
        );


        console.log(
            "CUPS command:"
        );

        console.log(
            "lp",
            args.join(" ")
        );


        /*
        |--------------------------------------------------------------------------
        | Execute lp
        |--------------------------------------------------------------------------
        */

        const {
            stdout
        } = await execFileAsync(
            "lp",
            args
        );


        console.log(
            "CUPS:",
            stdout
        );


        /*
        |--------------------------------------------------------------------------
        | Extract CUPS job ID
        |--------------------------------------------------------------------------
        */

        const match =
            stdout.match(
                /request id is\s+([^\s]+)/i
            );


        const cupsJobId =
            match
                ? match[1]
                : null;


        /*
        |--------------------------------------------------------------------------
        | Save CUPS ID
        |--------------------------------------------------------------------------
        */

        if (
            cupsJobId
        ) {

            await setCupsJobId(
                job._id,
                cupsJobId
            );
        }


        /*
        |--------------------------------------------------------------------------
        | Monitor CUPS
        |--------------------------------------------------------------------------
        */

        await monitorCupsJob(
            job._id,
            cupsJobId
        );


    } catch (error) {

        console.error(
            "Print failed:",
            error.message
        );


        await updateJobStatus(

            job._id,

            "failed",

            {
                error:
                    error.message
            }

        );
    }
}


/*
|--------------------------------------------------------------------------
| Monitor CUPS
|--------------------------------------------------------------------------
*/

async function monitorCupsJob(
    jobId,
    cupsJobId
) {

    if (!cupsJobId) {

        await updateJobStatus(
            jobId,
            "completed"
        );

        return;
    }


    /*
    |--------------------------------------------------------------------------
    | Check every 2 seconds
    |--------------------------------------------------------------------------
    */

    for (;;) {

        await sleep(2000);


        try {

            const {
                stdout
            } = await execFileAsync(
                "lpstat",
                [
                    "-W",
                    "not-completed",
                    "-o",
                    PRINTER_NAME
                ]
            );


            /*
            |--------------------------------------------------------------------------
            | Still present = printing
            |--------------------------------------------------------------------------
            */

            if (
                stdout.includes(
                    cupsJobId
                )
            ) {

                continue;
            }


            /*
            |--------------------------------------------------------------------------
            | No longer in queue
            |--------------------------------------------------------------------------
            */

            await updateJobStatus(
                jobId,
                "completed"
            );


            console.log(
                "Print completed:",
                jobId
            );


            /*
            |--------------------------------------------------------------------------
            | Start next job
            |--------------------------------------------------------------------------
            */

            await processQueue();


            break;


        } catch (error) {

            /*
            |--------------------------------------------------------------------------
            | If lpstat doesn't find job, consider completed
            |--------------------------------------------------------------------------
            */

            await updateJobStatus(
                jobId,
                "completed"
            );


            await processQueue();


            break;
        }
    }
}


/*
|--------------------------------------------------------------------------
| Sleep
|--------------------------------------------------------------------------
*/

function sleep(ms) {

    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                ms
            )
    );
}


/*
|--------------------------------------------------------------------------
| Polling
|--------------------------------------------------------------------------
*/

let isChecking =
    false;


async function pollServer() {

    if (
        isChecking
    ) {

        return;
    }


    isChecking = true;


    try {

        /*
        |--------------------------------------------------------------------------
        | Fetch at most one new server file
        |--------------------------------------------------------------------------
        */

        await checkForNewFile();


        /*
        |--------------------------------------------------------------------------
        | Process local queue
        |--------------------------------------------------------------------------
        */

        await processQueue();


    } catch (error) {

        console.error(
            "Polling error:",
            error.message
        );

    } finally {

        isChecking =
            false;
    }
}


/*
|--------------------------------------------------------------------------
| Start
|--------------------------------------------------------------------------
*/

async function start() {

    console.log("");
    console.log(
        "================================"
    );

    console.log(
        "UniKart Printer Client"
    );

    console.log(
        "================================"
    );

    console.log(
        "Server:",
        SERVER_URL
    );

    console.log(
        "MongoDB:",
        process.env.MONGO_URI
    );

    console.log(
        "Printer:",
        PRINTER_NAME
    );

    console.log(
        "Download:",
        DOWNLOAD_DIR
    );

    console.log(
        "Poll:",
        POLL_INTERVAL,
        "ms"
    );

    console.log(
        "Dashboard:",
        `http://localhost:${PORT}/dashboard`
    );

    console.log(
        "================================"
    );


    /*
    |--------------------------------------------------------------------------
    | MongoDB
    |--------------------------------------------------------------------------
    */

    await connectDatabase();


    /*
    |--------------------------------------------------------------------------
    | HTTP server
    |--------------------------------------------------------------------------
    */

    app.get(
        "/",
        (req, res) => {

            res.json({

                success: true,

                service:
                    "UniKart Printer Client",

                dashboard:
                    "/dashboard"

            });

        }
    );


    app.listen(
        PORT,
        () => {

            console.log(
                `Dashboard server running on port ${PORT}`
            );
        }
    );


    /*
    |--------------------------------------------------------------------------
    | Initial queue processing
    |--------------------------------------------------------------------------
    */

    await processQueue();


    /*
    |--------------------------------------------------------------------------
    | Initial server poll
    |--------------------------------------------------------------------------
    */

    await pollServer();


    /*
    |--------------------------------------------------------------------------
    | Correct polling interval
    |--------------------------------------------------------------------------
    */

    setInterval(
        pollServer,
        POLL_INTERVAL
    );
}


start();