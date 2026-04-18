declare module '@cashfreepayments/cashfree-js' {
  export type CashfreeMode = 'sandbox' | 'production';

  export type CashfreeCheckoutOptions = {
    paymentSessionId: string;
    returnUrl?: string | null;
    redirect?: 'always' | 'if_required';
    redirectTarget?: '_self' | '_blank' | '_top' | '_modal' | HTMLElement;
    payInParts?: boolean | null;
    offerID?: string | null;
    headerless?: boolean;
  };

  export type CashfreeCheckoutResult = {
    error?: {
      message?: string;
      code?: string;
      type?: string;
    };
    redirect?: boolean;
  };

  export type CashfreeInstance = {
    checkout(options: CashfreeCheckoutOptions): Promise<CashfreeCheckoutResult>;
  };

  export function load(options: { mode: CashfreeMode }): Promise<CashfreeInstance | null>;
}