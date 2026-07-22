"use client";

type Snapshot = {
  activeRequests: number;
  routePending: boolean;
};

type Listener = () => void;

const listeners = new Set<Listener>();

const state: Snapshot = {
  activeRequests: 0,
  routePending: false,
};

function emit() {
  listeners.forEach((listener) => listener());
}

export function subscribeLoading(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLoadingSnapshot() {
  return state;
}

export function beginRequest() {
  state.activeRequests += 1;
  emit();
}

export function endRequest() {
  state.activeRequests = Math.max(0, state.activeRequests - 1);
  emit();
}

export function beginRouteTransition() {
  if (!state.routePending) {
    state.routePending = true;
    emit();
  }
}

export function endRouteTransition() {
  if (state.routePending) {
    state.routePending = false;
    emit();
  }
}
