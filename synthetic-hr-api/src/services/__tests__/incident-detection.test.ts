import { IncidentDetectionService } from '../incident-detection';

describe('IncidentDetectionService', () => {
  let service: IncidentDetectionService;

  beforeEach(() => {
    service = new IncidentDetectionService();
  });

  describe('detectPII', () => {
    it('should detect email addresses', () => {
      const content = 'Customer email is john@example.com';
      const result = service.detectPII(content);

      expect(result.detected).toBe(true);
      expect(result.type).toBe('pii_leak');
      expect(result.severity).toBe('high');
      expect(result.confidence).toBe(0.95);
      expect(result.details).toContain('email');
    });

    it('should detect phone numbers', () => {
      const content = 'Call the customer at (555) 123-4567';
      const result = service.detectPII(content);

      expect(result.detected).toBe(true);
      expect(result.type).toBe('pii_leak');
    });

    it('should detect SSN', () => {
      const content = 'Customer SSN is 123-45-6789';
      const result = service.detectPII(content);

      expect(result.detected).toBe(true);
      expect(result.type).toBe('pii_leak');
      expect(result.details).toContain('ssn');
    });

    it('should detect credit card numbers', () => {
      const content = 'Credit card: 4532-1234-5678-9010';
      const result = service.detectPII(content);

      expect(result.detected).toBe(true);
      expect(result.type).toBe('pii_leak');
      expect(result.details).toContain('creditCard');
    });

    it('should mark as critical severity when multiple PII types found', () => {
      const content = 'Email: john@example.com, SSN: 123-45-6789, Phone: (555) 123-4567';
      const result = service.detectPII(content);

      expect(result.detected).toBe(true);
      expect(result.severity).toBe('critical');
    });

    it('should not detect PII when none present', () => {
      const content = 'This is a normal customer message without sensitive data';
      const result = service.detectPII(content);

      expect(result.detected).toBe(false);
      expect(result.type).toBeNull();
      expect(result.severity).toBe('low');
    });
  });

  describe('detectRefundAbuse', () => {
    it('should detect approval without proper verification', () => {
      const content = 'I will approve this refund without checking the original purchase';
      const result = service.detectRefundAbuse(content);

      expect(result.detected).toBe(true);
      expect(result.type).toBe('refund_abuse');
      expect(result.severity).toBe('high');
    });

    it('should detect policy override attempts', () => {
      const content = 'Let me make an exception to override our refund policy';
      const result = service.detectRefundAbuse(content);

      expect(result.detected).toBe(true);
      expect(result.type).toBe('refund_abuse');
    });

    it('should not flag normal refund processing', () => {
      const content = 'I have verified the purchase and will process this refund according to policy';
      const result = service.detectRefundAbuse(content);

      expect(result.detected).toBe(false);
    });
  });

  describe('detectLegalAdvice', () => {
    it('should detect when AI provides legal advice', () => {
      const content = 'You should file a lawsuit against them for violation of contract law';
      const result = service.detectLegalAdvice(content);

      expect(result.detected).toBe(true);
      expect(result.type).toBe('legal_advice');
      expect(result.severity).toBe('high');
    });

    it('should detect when AI needs legal counsel reference', () => {
      const content = 'This is a legal matter that requires consulting an attorney';
      const result = service.detectLegalAdvice(content);

      expect(result.detected).toBe(true);
    });
  });

  describe('detectToxicity', () => {
    it('should detect discriminatory language', () => {
      const content = 'I cannot help customers of that race';
      const result = service.detectToxicity(content);

      expect(result.detected).toBe(true);
      expect(result.type).toBe('toxic_output');
      expect(result.severity).toBe('critical');
    });

    it('should detect violent language', () => {
      const content = 'We should hurt anyone who complains';
      const result = service.detectToxicity(content);

      expect(result.detected).toBe(true);
      expect(result.severity).toBe('critical');
    });
  });

});
