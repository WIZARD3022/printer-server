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

const printerStateSchema = new mongoose.Schema(
    {
        _id: {
            type: String,
            default: "default"
        },
        printerName: String,
        state: {
            type: String,
            enum: ["ready", "printing", "paused", "offline", "error", "unknown"],
            default: "unknown"
        },
        connected: {
            type: Boolean,
            default: false
        },
        message: String,
        activeJobId: String,
        lastCommand: String,
        lastError: String,
        checkedAt: Date
    },
    {
        timestamps: true
    }
);

const backupSchema = new mongoose.Schema(
    {
        _id: {
            type: String,
            required: true
        },
        backupDate: {
            type: String,
            required: true,
            index: true
        },
        status: {
            type: String,
            enum: ["pending", "running", "completed", "failed"],
            default: "pending",
            index: true
        },
        path: String,
        size: Number,
        error: String,
        trigger: {
            type: String,
            enum: ["scheduled", "manual"],
            default: "scheduled"
        },
        completedAt: Date
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

const PrinterState =
    mongoose.models.PrinterState ||
    mongoose.model("PrinterState", printerStateSchema);

const Backup =
    mongoose.models.Backup ||
    mongoose.model("Backup", backupSchema);


/*
|--------------------------------------------------------------------------
| Create Print Job
|--------------------------------------------------------------------------
*/

async function createPrintJob(data) {

    const update = {
        userId: data.userId,
        orderId: data.orderId,
        cupsJobId: data.cupsJobId,
        originalName: data.originalName,
        localFile: data.localFile,
        file: data.file,
        size: data.size,
        options: data.options || {},
        folder: data.folder,
        priority: data.priority || 0,
        queuePosition: data.queuePosition || 0,
        status: data.status || "pending",
        error: data.error
    };

    Object.keys(update).forEach(key => {
        if (update[key] === undefined) {
            delete update[key];
        }
    });

    return await PrintJob.findByIdAndUpdate(
        data._id,
        { $set: update },
        {
            returnDocument: "after",
            upsert: true,
            setDefaultsOnInsert: true,
            runValidators: true
        }
    );
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

async function getOrder(orderId) {
    if (!orderId) {
        return null;
    }

    return await mongoose.connection.collection("orders").findOne({
        _id: orderId
    });
}

async function getUser(userId) {
    if (!userId) {
        return null;
    }

    return await mongoose.connection.collection("users").findOne({
        _id: userId
    });
}

async function getUsersByIds(userIds) {
    const ids = [...new Set(
        userIds.filter(Boolean).map(String)
    )];

    if (ids.length === 0) {
        return new Map();
    }

    const users = await mongoose.connection.collection("users")
        .find({ _id: { $in: ids } })
        .toArray();

    return new Map(users.map(user => [String(user._id), user]));
}

async function updateOrderStatus(orderId, status) {
    if (!orderId) {
        return { matchedCount: 0, modifiedCount: 0 };
    }

    return await mongoose.connection.collection("orders").updateOne(
        { _id: orderId },
        {
            $set: {
                status,
                updatedAt: new Date()
            }
        }
    );
}

async function upsertBackup(backupDate, data = {}) {
    return await Backup.findOneAndUpdate(
        { backupDate },
        {
            $set: data,
            $setOnInsert: {
                _id: backupDate
            }
        },
        {
            upsert: true,
            returnDocument: "after",
            setDefaultsOnInsert: true
        }
    );
}

async function getBackup(backupDate) {
    return await Backup.findOne({ backupDate });
}

async function getRecentBackups(limit = 10) {
    return await Backup.find()
        .sort({ backupDate: -1 })
        .limit(limit);
}


/*
|--------------------------------------------------------------------------
| Get all pending jobs
|--------------------------------------------------------------------------
*/

async function getPendingJobs() {

    return await PrintJob
        .find({
            status: {
                $in: ["pending", "failed"]
            }
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
        status: {
            $in: ["processing", "submitted"]
        }
    }).sort({
        updatedAt: -1
    });
}

async function getRecoverableJob() {
    return await PrintJob.findOne({
        status: {
            $in: ["processing", "submitted"]
        }
    }).sort({
        updatedAt: -1
    });
}

async function getPrinterState() {
    return await PrinterState.findById("default");
}

async function updatePrinterState(data) {
    const set = {
        ...data,
        checkedAt: new Date()
    };

    const unset = {};

    Object.keys(set).forEach(key => {
        if (set[key] === undefined) {
            unset[key] = "";
            delete set[key];
        }
    });

    return await PrinterState.findByIdAndUpdate(
        "default",
        {
            $set: set,
            ...(Object.keys(unset).length > 0 ? { $unset: unset } : {})
        },
        {
            returnDocument: "after",
            upsert: true,
            setDefaultsOnInsert: true
        }
    );
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
    const set = {
        status,
        ...extra
    };

    const unset = {};

    Object.keys(set).forEach(key => {
        if (set[key] === undefined) {
            unset[key] = "";
            delete set[key];
        }
    });

    return await PrintJob.findByIdAndUpdate(

        jobId,

        {
            $set: set,
            ...(Object.keys(unset).length > 0 ? { $unset: unset } : {})
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

    const current = await PrintJob.findById(jobId);
    if (!current) {
        return null;
    }

    return await PrintJob.findByIdAndUpdate(

        jobId,

        {
            $set: {
                cupsJobId,
                ...(current.status === "cancelled" ? {} : { status: "submitted" })
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
    Backup,

    createPrintJob,

    getPrintJob,
    getOrder,
    getUser,

    getUsersByIds,
    updateOrderStatus,
    upsertBackup,
    getBackup,
    getRecentBackups,
    getPendingJobs,

    getProcessingJob,
    getRecoverableJob,
    getPrinterState,
    updatePrinterState,

    updateJobStatus,

    setCupsJobId,

    getQueue,

    getPrintHistory
};