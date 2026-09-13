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
    process.env.PRINTER_NAME;


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

async function downloadFile(file, acknowledge = false) {

    const folder =
        file.folder;

    const originalFilename =
        path.basename(file.name);

    const extension =
        path.extname(originalFilename).toLowerCase();

    const safeBaseName =
        path.basename(
            originalFilename,
            extension
        ).replace(
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
            `${safeBaseName}${extension}`
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


        /*
        |--------------------------------------------------------------------------
        | Download from UniKart server
        |--------------------------------------------------------------------------
        */

        const response =
            await api.get(

                file.downloadUrl ||
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


        /*
        |--------------------------------------------------------------------------
        | Write temporary file
        |--------------------------------------------------------------------------
        */

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
        | Verify temporary file exists
        |--------------------------------------------------------------------------
        */

        if (
            !fs.existsSync(tempPath)
        ) {

            throw new Error(
                `Downloaded file does not exist: ${tempPath}`
            );
        }


        /*
        |--------------------------------------------------------------------------
        | Convert to PDF if required
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
        | Verify PDF exists
        |--------------------------------------------------------------------------
        */

        if (
            !fs.existsSync(pdfPath)
        ) {

            throw new Error(
                `PDF conversion failed. File not found: ${pdfPath}`
            );
        }


        /*
        |--------------------------------------------------------------------------
        | Destination folder
        |--------------------------------------------------------------------------
        */

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


        /*
        |--------------------------------------------------------------------------
        | Always save final file as .pdf
        |--------------------------------------------------------------------------
        */

        let finalFilename =
            path.basename(pdfPath);


        /*
        |--------------------------------------------------------------------------
        | Make sure extension is .pdf
        |--------------------------------------------------------------------------
        */

        if (
            !finalFilename
                .toLowerCase()
                .endsWith(".pdf")
        ) {

            finalFilename =
                `${safeBaseName}.pdf`;
        }


        const finalPath =
            path.join(
                finalFolder,
                finalFilename
            );


        /*
        |--------------------------------------------------------------------------
        | Move/copy PDF to final location
        |--------------------------------------------------------------------------
        */

        fs.copyFileSync(
            pdfPath,
            finalPath
        );


        /*
        |--------------------------------------------------------------------------
        | Now it is safe to remove temporary files
        |--------------------------------------------------------------------------
        */

        if (
            fs.existsSync(tempPath) &&
            tempPath !== pdfPath
        ) {

            fs.unlinkSync(
                tempPath
            );
        }


        /*
        |--------------------------------------------------------------------------
        | If PDF was created separately in temp,
        | delete it after copying
        |--------------------------------------------------------------------------
        */

        if (
            pdfPath !== tempPath &&
            fs.existsSync(pdfPath)
        ) {

            fs.unlinkSync(
                pdfPath
            );
        }


        /*
        |--------------------------------------------------------------------------
        | Verify final file
        |--------------------------------------------------------------------------
        */

        if (
            !fs.existsSync(finalPath)
        ) {

            throw new Error(
                `Final PDF was not created: ${finalPath}`
            );
        }


        const stats =
            fs.statSync(
                finalPath
            );


        console.log("");
        console.log(
            "PDF SAVED SUCCESSFULLY"
        );

        console.log(
            "Original:",
            originalFilename
        );

        console.log(
            "PDF:",
            finalFilename
        );

        console.log(
            "Folder:",
            folder
        );

        console.log(
            "Path:",
            finalPath
        );

        console.log(
            "Size:",
            stats.size,
            "bytes"
        );


        /*
        |--------------------------------------------------------------------------
        | ACK only AFTER local PDF is safely saved
        |--------------------------------------------------------------------------
        */

        if (acknowledge) {
            await acknowledgeFile(
                folder,
                originalFilename
            );

            console.log(
                "Server file acknowledged."
            );
        }


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

        console.error(
            "\nFile processing failed:"
        );

        console.error(
            error.message
        );


        /*
        |--------------------------------------------------------------------------
        | Cleanup temporary files
        |--------------------------------------------------------------------------
        */

        if (
            fs.existsSync(tempPath)
        ) {

            try {

                fs.unlinkSync(
                    tempPath
                );

            } catch (cleanupError) {

                console.error(
                    "Temp cleanup failed:",
                    cleanupError.message
                );
            }
        }


        /*
        |--------------------------------------------------------------------------
        | IMPORTANT:
        | Do not ACK the server file if anything failed.
        |--------------------------------------------------------------------------
        */

        console.log(
            "Server file was NOT acknowledged."
        );

        console.log(
            "It will be retried."
        );


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
        ).toLowerCase();


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
    | Office / other supported formats
    |--------------------------------------------------------------------------
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

async function acknowledgeOriginalFile(folder, originalName) {
    const response = await api.post(
        "/api/files/ack-by-original",
        {
            folder,
            originalName
        }
    );

    console.log(
        "Server file acknowledged:",
        response.data.message
    );
}

async function acknowledgePrintedFile(job) {
    if (!job.folder || !job.originalName) {
        return;
    }

    try {
        await acknowledgeOriginalFile(
            job.folder,
            job.originalName
        );
    } catch (error) {
        console.error(
            "Could not acknowledge printed file:",
            error.message
        );
    }
}


/*
|--------------------------------------------------------------------------
| Fetch next file
|--------------------------------------------------------------------------
*/

async function checkForNewFile() {

    try {
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

        jobs.sort((first, second) => {
            const firstPriority =
                first.folder === "express" ? 100 : first.priority || 0;

            const secondPriority =
                second.folder === "express" ? 100 : second.priority || 0;

            if (firstPriority !== secondPriority) {
                return secondPriority - firstPriority;
            }

            return first.createdAt - second.createdAt;
        });


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

        if (!job.localFile || !fs.existsSync(job.localFile)) {
            try {
                const downloaded = await downloadFile({
                    folder: job.folder,
                    name: job.originalName,
                    downloadUrl:
                        `/api/files/download-by-original/` +
                        `${encodeURIComponent(job.folder)}/` +
                        `${encodeURIComponent(job.originalName)}`
                });

                await updateJobStatus(
                    job._id,
                    "pending",
                    {
                        localFile: downloaded.localPath,
                        size: downloaded.size
                    }
                );

                job.localFile = downloaded.localPath;
            } catch (error) {
                await updateJobStatus(
                    job._id,
                    "failed",
                    {
                        error: `File download failed: ${error.message}`
                    }
                );

                console.error(
                    "File download failed:",
                    error.message
                );

                return;
            }
        }


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
            cupsJobId,
            job
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
    cupsJobId,
    job
) {

    if (!cupsJobId) {

        await updateJobStatus(
            jobId,
            "completed"
        );

        await acknowledgePrintedFile(job);

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

            await acknowledgePrintedFile(job);


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

            await acknowledgePrintedFile(job);


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
    | Correct polling interval
    |--------------------------------------------------------------------------
    */

    setInterval(
        pollServer,
        POLL_INTERVAL
    );
}


start();