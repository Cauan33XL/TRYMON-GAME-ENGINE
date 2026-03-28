type EventCallback = (data?: any) => void;

export const EventBus = {
  events: {} as Record<string, EventCallback[]>,
  on(event: string, callback: EventCallback) {
    if (!this.events[event]) this.events[event] = [];
    this.events[event].push(callback);
  },
  emit(event: string, data?: any) {
    if (this.events[event]) this.events[event].forEach(cb => cb(data));
  },
  off(event: string) {
    this.events[event] = [];
  }
};
