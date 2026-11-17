import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ScheduleSendDialog } from '../schedule-send-dialog';

// Schedule send (composer) and Reschedule (Scheduled folder) pick the time in
// one dialog: a real dialog that takes the focus, keeps Tab inside and closes
// on Escape (R4), with the presets and a date-time field.

describe('ScheduleSendDialog', () => {
  it('submits the visible native picker value even when its change event has not reached React',()=>{
    const onSchedule=vi.fn();const props={isOpen:true,onClose:vi.fn(),onSchedule,supported:true};
    const {rerender}=render(<ScheduleSendDialog {...props}/>);
    const input=screen.getByRole('dialog').querySelector('input[type="datetime-local"]') as HTMLInputElement;
    // The browser picker/autofill updates the native value independently of
    // React's controlled-value tracker; no synthetic change is dispatched.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'2030-11-19T16:45');
    // Blur and a parent update must not restore the previous default before
    // the actual footer-button submit (the production MUI dialog path).
    fireEvent.blur(input);
    rerender(<ScheduleSendDialog {...props} title="reschedule_send"/>);
    expect(input.value).toBe('2030-11-19T16:45');
    fireEvent.click(screen.getByRole('button',{name:'reschedule_send'}));
    expect(onSchedule).toHaveBeenCalledWith(new Date('2030-11-19T16:45').toISOString());
  });
  it('validates a native picker commit against the server maximum as well',()=>{
    const onSchedule=vi.fn();render(<ScheduleSendDialog isOpen onClose={vi.fn()} onSchedule={onSchedule} supported maxDelayedSend={3600}/>);
    const input=screen.getByRole('dialog').querySelector('input[type="datetime-local"]') as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'2030-11-19T16:45');
    fireEvent.submit(input.closest('form')!);
    expect(onSchedule).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent('schedule_send_too_late');
  });
  it('is a dialog that closes on Escape', () => {
    const onClose = vi.fn();
    render(<ScheduleSendDialog isOpen onClose={onClose} onSchedule={vi.fn()} supported />);
    const dialog = screen.getByRole('dialog', { name: 'schedule_send' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('schedules a preset in one click', () => {
    const onSchedule = vi.fn();
    render(<ScheduleSendDialog isOpen onClose={vi.fn()} onSchedule={onSchedule} supported />);
    fireEvent.click(screen.getByText('schedule_preset.tomorrow_morning'));
    expect(onSchedule).toHaveBeenCalledTimes(1);
    expect(new Date(onSchedule.mock.calls[0][0]).getHours()).toBe(8);
  });

  it('refuses a time in the past and says why', () => {
    const onSchedule = vi.fn();
    render(<ScheduleSendDialog isOpen onClose={vi.fn()} onSchedule={onSchedule} supported title="reschedule_send" />);
    fireEvent.change(screen.getByRole('dialog').querySelector('input[type="datetime-local"]')!, { target: { value: '2020-01-01T08:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'reschedule_send' }));
    expect(onSchedule).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe('schedule_send_future');
  });
});
