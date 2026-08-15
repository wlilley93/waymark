import type * as React from "react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  OptionHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

// The primitive layer (VDS composition R4): every interactive control on a
// governed screen composes a REGISTERED primitive, never a bare element.
// The token layer (--control-border on --surface, 3.46:1) lives in styles.css.

export function Button(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} />;
}

export function Input(
  props: Omit<InputHTMLAttributes<HTMLInputElement>, "ref"> & {
    ref?: React.Ref<HTMLInputElement>;
  },
) {
  return <input {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} />;
}

export function Option(props: OptionHTMLAttributes<HTMLOptionElement>) {
  return <option {...props} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} />;
}

export function Checkbox(props: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  const { label, ...rest } = props;
  if (label === undefined) return <input type="checkbox" {...rest} />;
  return (
    <label className="checkbox">
      <input type="checkbox" {...rest} /> {label}
    </label>
  );
}
