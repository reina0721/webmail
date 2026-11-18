import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTimeoutWhileMounted } from '@/hooks/use-timeout-while-mounted';

describe('useTimeoutWhileMounted', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the callback after the delay while the component is mounted', () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const { result } = renderHook(() => useTimeoutWhileMounted());

    result.current(callback, 500);
    vi.advanceTimersByTime(499);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('drops every pending callback when the component unmounts', () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const { result, unmount } = renderHook(() => useTimeoutWhileMounted());

    result.current(callback, 500);
    result.current(callback, 800);
    unmount();
    vi.advanceTimersByTime(1000);
    expect(callback).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores a timer scheduled by an action that finishes after unmount', async () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const { result, unmount } = renderHook(() => useTimeoutWhileMounted());
    const schedule = result.current;
    const completion = Promise.resolve().then(() => schedule(callback, 400));

    unmount();
    await completion;

    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(400);
    expect(callback).not.toHaveBeenCalled();
  });
});
