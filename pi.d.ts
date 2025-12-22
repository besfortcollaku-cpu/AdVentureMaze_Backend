/**
 * Axios client for Pi API
 */
export declare const pi: any;
/**
 * Approve a Pi payment
 */
export declare function approvePiPayment(paymentId: string): Promise<void>;
/**
 * Complete a Pi payment
 */
export declare function completePiPayment(paymentId: string, txid: string): Promise<void>;
//# sourceMappingURL=pi.d.ts.map