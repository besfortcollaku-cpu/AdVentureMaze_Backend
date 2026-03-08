// src/piPay.js

export async function startPiPayment({ backendBase, amount, memo, metadata, accessToken }) {

  if (!window.Pi) throw new Error("Pi SDK not available. Open inside Pi Browser.");



  // 1) Create payment on Pi

  const payment = await window.Pi.createPayment(

    { amount, memo, metadata },

    {

      onReadyForServerApproval: async (paymentId) => {

        await fetch(`${backendBase}/payments/approve`, {

          method: "POST",

          headers: {

            "Content-Type": "application/json",

            Authorization: `Bearer ${accessToken}`,

          },

          body: JSON.stringify({ paymentId }),

        });

      },



      onReadyForServerCompletion: async (paymentId, txid) => {

        await fetch(`${backendBase}/payments/complete`, {

          method: "POST",

          headers: {

            "Content-Type": "application/json",

            Authorization: `Bearer ${accessToken}`,

          },

          body: JSON.stringify({ paymentId, txid }),

        });

      },



      onCancel: (paymentId) => {

        console.log("Payment cancelled:", paymentId);

      },



      onError: (err, payment) => {

        console.error("Payment error:", err, payment);

        throw err;

      },

    }

  );



  return payment;

}