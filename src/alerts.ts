export type AlertItem = {
  id: string;
  properties: {
    '@id'?: string;
    event: string;
    headline?: string;
    severity?: string;
    urgency?: string;
    areaDesc?: string;
    ends?: string;
    senderName?: string;
    description?: string;
    instruction?: string;
    web?: string;
  };
};

export type AlertSnapshot = {
  alerts: AlertItem[];
  point: { latitude: number; longitude: number };
  checked: string;
  countryCode: 'US' | 'MX';
};
