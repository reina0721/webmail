"use client";

import * as React from "react";
import { NativeFieldShell } from "@mail-web/ui/native-controls";

type ControlProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  "aria-required"?: boolean | "true" | "false";
};

export interface FieldProps {
  /** The visible label. It names the control, so a placeholder never has to. */
  label: React.ReactNode;
  /** One line under the control, read with it. Hidden while there is an error. */
  hint?: React.ReactNode;
  /** The error under the control: read with it, announced, and marks it invalid. */
  error?: React.ReactNode;
  /** Draws the asterisk and sets aria-required on the control. */
  required?: boolean;
  /** Keep the label for screen readers only (a field whose look already says what it is). */
  hideLabel?: boolean;
  className?: string;
  labelClassName?: string;
  /** The one control (Input, select, textarea, ...). */
  children: React.ReactElement<ControlProps>;
}

/**
 * A labelled form field backed by Material UI NativeFieldShell: label above,
 * control, hint or error below.
 */
export function Field({ label, hint, error, required = false, hideLabel = false, className, labelClassName, children }: FieldProps) {
  const autoId = React.useId();
  const controlId = children.props.id ?? `${autoId}-control`;
  const noteId = `${autoId}-note`;
  const note = error || hint;
  const control = React.cloneElement(children, {
    id: controlId,
    "aria-describedby": [children.props["aria-describedby"], note ? noteId : null].filter(Boolean).join(" ") || undefined,
    ...(error ? { "aria-invalid": true } : {}),
    ...(required ? { "aria-required": true } : {}),
  });
  return (
    <NativeFieldShell
      controlId={controlId}
      noteId={noteId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      hideLabel={hideLabel}
      className={className}
      labelClassName={labelClassName}
    >
      {control}
    </NativeFieldShell>
  );
}
