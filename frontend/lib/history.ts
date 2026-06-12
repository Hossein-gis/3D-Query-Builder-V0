import { SearchHistoryEntry } from '@/shared/types';

const HISTORY_KEY = 'qb_search_history';

export const historyService = {
  getAll(): SearchHistoryEntry[] {
    if (typeof window === 'undefined') return [];
    const stored = localStorage.getItem(HISTORY_KEY);
    return stored ? JSON.parse(stored) : [];
  },

  save(entries: SearchHistoryEntry[]) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
  },

  add(entry: SearchHistoryEntry) {
    const entries = this.getAll();
    entries.unshift(entry); // newest first
    this.save(entries);
    return entry;
  },

  update(id: string, updates: Partial<SearchHistoryEntry>) {
    const entries = this.getAll();
    const index = entries.findIndex(e => e.id === id);
    if (index !== -1) {
      entries[index] = { ...entries[index], ...updates };
      this.save(entries);
    }
    return entries[index];
  },

  remove(id: string) {
    const entries = this.getAll().filter(e => e.id !== id);
    this.save(entries);
  },

  clear() {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(HISTORY_KEY);
  }
};