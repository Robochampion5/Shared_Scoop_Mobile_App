"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lockPoolAndRequestPayments = void 0;
const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();
exports.lockPoolAndRequestPayments = functions.https.onCall(async (data, context) => {
    const { poolId } = data;
    if (!poolId) {
        throw new functions.https.HttpsError('invalid-argument', 'The function must be called with one argument "poolId"');
    }
    // 1. Verify Admin Auth Context here
    // 2. Query Firestore for pledged members
    // 3. Ping Razorpay API to generate links
    // 4. Update Firestore pool status to 'locked'
    return { success: true, message: "Razorpay links generated." };
});
//# sourceMappingURL=index.js.map