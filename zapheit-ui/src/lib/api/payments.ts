import { authenticatedFetch } from './_helpers';
import type { ApiResponse } from './_helpers';

export type PaymentOrderStatus = 'created' | 'pending' | 'paid' | 'failed' | 'cancelled' | 'expired';

export type PaymentOffer = {
  code: string;
  name: string;
  description: string;
  amount: number;
  currency: string;
  mode: 'one_time' | 'subscription';
  provider: 'cashfree';
  checkoutMode: 'hosted';
  activationMode: 'manual_review' | 'auto_activate';
};

export type PaymentOrder = {
  id: string;
  organizationId: string;
  createdBy: string | null;
  provider: 'cashfree';
  offerCode: string;
  offerName: string;
  merchantOrderId: string;
  providerOrderId: string | null;
  paymentSessionId: string | null;
  providerOrderStatus: string | null;
  status: PaymentOrderStatus;
  currency: string;
  amount: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  companyName: string | null;
  returnUrl: string | null;
  paidAt: string | null;
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
};

export type CreatePaymentOrderInput = {
  offerCode?: 'audit';
  customerName: string;
  customerEmail?: string;
  customerPhone: string;
  companyName?: string;
  returnPath?: string;
  note?: string;
};

export const paymentsApi = {
  async listOffers(): Promise<ApiResponse<PaymentOffer[]>> {
    return authenticatedFetch('/payments/offers', { method: 'GET' });
  },

  async listOrders(params?: { status?: PaymentOrderStatus; limit?: number }): Promise<ApiResponse<PaymentOrder[]>> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.limit) query.set('limit', String(params.limit));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return authenticatedFetch(`/payments/orders${suffix}`, { method: 'GET' });
  },

  async getOrder(id: string): Promise<ApiResponse<PaymentOrder>> {
    return authenticatedFetch(`/payments/orders/${id}`, { method: 'GET' });
  },

  async getOrderByMerchantOrderId(merchantOrderId: string): Promise<ApiResponse<PaymentOrder>> {
    return authenticatedFetch(`/payments/orders/by-merchant/${encodeURIComponent(merchantOrderId)}`, { method: 'GET' });
  },

  async createOrder(input: CreatePaymentOrderInput): Promise<ApiResponse<PaymentOrder> & {
    checkout?: {
      provider: 'cashfree';
      mode: 'hosted';
      environment: 'sandbox' | 'production';
      paymentSessionId: string | null;
      orderId: string;
      returnUrl: string;
    };
  }> {
    return authenticatedFetch(`/payments/orders`, {
      method: 'POST',
      body: JSON.stringify(input),
    }) as Promise<ApiResponse<PaymentOrder> & {
      checkout?: {
        provider: 'cashfree';
        mode: 'hosted';
        environment: 'sandbox' | 'production';
        paymentSessionId: string | null;
        orderId: string;
        returnUrl: string;
      };
    }>;
  },

  async syncOrder(id: string): Promise<ApiResponse<PaymentOrder>> {
    return authenticatedFetch(`/payments/orders/${id}/sync`, {
      method: 'POST',
    });
  },

  async syncOrderByMerchantOrderId(merchantOrderId: string): Promise<ApiResponse<PaymentOrder>> {
    return authenticatedFetch(`/payments/orders/by-merchant/${encodeURIComponent(merchantOrderId)}/sync`, {
      method: 'POST',
    });
  },
};

export default paymentsApi;