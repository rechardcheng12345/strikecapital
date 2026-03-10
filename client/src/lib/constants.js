export const API_BASE_URL = '/api';
export const POSITION_STATUS = {
    OPEN: { label: 'Open', color: 'bg-green-100 text-green-800' },
    MONITORING: { label: 'Monitoring', color: 'bg-yellow-100 text-yellow-800' },
    ROLLING: { label: 'Rolling', color: 'bg-blue-100 text-blue-800' },
    EXPIRY: { label: 'Expiry', color: 'bg-orange-100 text-orange-800' },
    RESOLVED: { label: 'Resolved', color: 'bg-gray-100 text-gray-800' },
};
export const RESOLUTION_TYPE = {
    expired_worthless: { label: 'Expired Worthless', color: 'text-green-600' },
    rolled: { label: 'Rolled', color: 'text-blue-600' },
    assigned: { label: 'Assigned', color: 'text-red-600' },
    bought_to_close: { label: 'Bought to Close', color: 'text-orange-600' },
    sold: { label: 'Sold', color: 'text-purple-600' },
};
export const POSITION_TYPE = {
    option: { label: 'Cash-Secured Put', shortLabel: 'Option', color: 'bg-blue-100 text-blue-800' },
    stock: { label: 'Stock Position', shortLabel: 'Stock', color: 'bg-purple-100 text-purple-800' },
};
export const NOTIFICATION_TYPE = {
    position_opened: { label: 'Position Opened', color: 'bg-green-50 text-green-700' },
    position_resolved: { label: 'Position Resolved', color: 'bg-blue-50 text-blue-700' },
    position_rolled: { label: 'Position Rolled', color: 'bg-purple-50 text-purple-700' },
    expiry_reminder: { label: 'Expiry Reminder', color: 'bg-orange-50 text-orange-700' },
    announcement: { label: 'Announcement', color: 'bg-indigo-50 text-indigo-700' },
    pnl_update: { label: 'P&L Update', color: 'bg-teal-50 text-teal-700' },
};
