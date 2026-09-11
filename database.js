/*
|--------------------------------------------------------------------------
| database.js
|--------------------------------------------------------------------------
| MongoDB connection + PrintJob model + database operations
|--------------------------------------------------------------------------
*/

const mongoose = require("mongoose");

/*
|--------------------------------------------------------------------------
| MongoDB connection
|--------------------------------------------------------------------------
*/

let isConnected = false;

async function connectDatabase() {

    if (isConnected) {
        return;
    }

    try {

        await mongoose.connect(
            process.env.MONGO_URI
        );

        isConnected = true;

        console.log(
            "================================"
        );

        console.log(
            "MongoDB Connected"
        );

        console.log(
            "Database:",
            mongoose.connection.name
        );

        console.log(
            "================================"
        );

    } catch (error) {

        console.error(
            "MongoDB connection failed:",
            error.message
        );

        process.exit(1);
    }
}


/*
|--------------------------------------------------------------------------
| PrintJob Schema
|--------------------------------------------------------------------------
*/

const printJobSchema = new mongoose.Schema(
    {

        _id: {
            type: String,
            required: true
        },

        userId: {
            type: String,
            required: true,
            index: true
        },

        orderId: {
            type: String,
            index: true
        },

        cupsJobId: {
            type: String,
            index: true
        },

        originalName: {
            type: String
        },

        /*
        |------------------------------------------------------------------
        | Local PDF path
        |------------------------------------------------------------------
        */

        localFile: {
            type: String
        },

        /*
        |------------------------------------------------------------------
        | Original server file
        |------------------------------------------------------------------
        */

        file: {
            type: String
        },

        size: {
            type: Number
        },

        /*
        |------------------------------------------------------------------
        | Print configuration
        |------------------------------------------------------------------
        */

        options: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        },

        /*
        |------------------------------------------------------------------
        | Queue information
        |------------------------------------------------------------------
        */

        folder: {
            type: String,
            enum: [
                "normal",
                "express",
                "cash"
            ]
        },

        priority: {
            type: Number,
            default: 0
        },

        queuePosition: {
            type: Number,
            default: 0
        },

        /*
        |------------------------------------------------------------------
        | Status
        |------------------------------------------------------------------
        */

        status: {
            type: String,

            enum: [
                "pending",
                "submitted",
                "processing",
                "completed",
                "cancelled",
                "failed",
                "unknown"
            ],

            default: "pending",

            index: true
        },

        error: {
            type: String
        }

    },
    {
        timestamps: true
    }
);


/*
|--------------------------------------------------------------------------
| Model
|--------------------------------------------------------------------------
*/

const PrintJob =
    mongoose.models.PrintJob ||
    mongoose.model(
        "PrintJob",
        printJobSchema
    );


/*
|--------------------------------------------------------------------------
| Create Print Job
|--------------------------------------------------------------------------
*/

async function createPrintJob(data) {

    const job =
        new PrintJob({

            _id:
                data._id,

            userId:
                data.userId,

            orderId:
                data.orderId,

            cupsJobId:
                data.cupsJobId,

            originalName:
                data.originalName,

            localFile:
                data.localFile,

            file:
                data.file,

            size:
                data.size,

            options:
                data.options || {},

            folder:
                data.folder,

            priority:
                data.priority || 0,

            queuePosition:
                data.queuePosition || 0,

            status:
                data.status || "pending",

            error:
                data.error
        });


    await job.save();

    return job;
}


/*
|--------------------------------------------------------------------------
| Get job by ID
|--------------------------------------------------------------------------
*/

async function getPrintJob(jobId) {

    return await PrintJob.findById(
        jobId
    );
}


/*
|--------------------------------------------------------------------------
| Get all pending jobs
|--------------------------------------------------------------------------
*/

async function getPendingJobs() {

    return await PrintJob
        .find({
            status: "pending"
        })
        .sort({
            priority: -1,
            createdAt: 1
        });
}


/*
|--------------------------------------------------------------------------
| Get processing job
|--------------------------------------------------------------------------
*/

async function getProcessingJob() {

    return await PrintJob.findOne({
        status: "processing"
    });
}


/*
|--------------------------------------------------------------------------
| Update status
|--------------------------------------------------------------------------
*/

async function updateJobStatus(
    jobId,
    status,
    extra = {}
) {

    return await PrintJob.findByIdAndUpdate(

        jobId,

        {
            $set: {
                status,
                ...extra
            }
        },

        {
    returnDocument: "after"
}
    );
}


/*
|--------------------------------------------------------------------------
| Set CUPS Job ID
|--------------------------------------------------------------------------
*/

async function setCupsJobId(
    jobId,
    cupsJobId
) {

    return await PrintJob.findByIdAndUpdate(

        jobId,

        {
            $set: {
                cupsJobId,
                status: "submitted"
            }
        },

        {
    returnDocument: "after"
}
    );
}


/*
|--------------------------------------------------------------------------
| Get queue
|--------------------------------------------------------------------------
*/

async function getQueue() {

    return await PrintJob
        .find({
            status: {
                $in: [
                    "pending",
                    "processing",
                    "submitted"
                ]
            }
        })
        .sort({
            priority: -1,
            createdAt: 1
        });
}


/*
|--------------------------------------------------------------------------
| Get completed history
|--------------------------------------------------------------------------
*/

async function getPrintHistory(
    limit = 100
) {

    return await PrintJob
        .find({
            status: {
                $in: [
                    "completed",
                    "failed",
                    "cancelled"
                ]
            }
        })
        .sort({
            updatedAt: -1
        })
        .limit(limit);
}


/*
|--------------------------------------------------------------------------
| Export
|--------------------------------------------------------------------------
*/

module.exports = {

    connectDatabase,

    PrintJob,

    createPrintJob,

    getPrintJob,

    getPendingJobs,

    getProcessingJob,

    updateJobStatus,

    setCupsJobId,

    getQueue,

    getPrintHistory
};