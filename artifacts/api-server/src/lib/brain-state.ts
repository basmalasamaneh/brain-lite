// In-process coordination for personal-data deletion and new writes.
export const activeCaptures = new Set<string>();
export const deletingUsers = new Set<string>();
export const activeUploadRequests = new Map<string, number>();
export const activeQuestions = new Map<string, number>();