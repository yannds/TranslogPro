/**
 * FormField — Wrapper react-hook-form + Zod DRY
 *
 * Connecte automatiquement :
 *   - register() / Controller de react-hook-form
 *   - Messages d'erreur Zod via fieldState.error.message
 *   - Accessibilité (aria-invalid, aria-describedby)
 *
 * Usage :
 *   const form = useForm<MySchema>({ resolver: zodResolver(mySchema) });
 *
 *   <FormField control={form.control} name="email" label="Email" >
 *     {(field, error) => <Input {...field} error={error} type="email" />}
 *   </FormField>
 *
 * Ou version abrégée avec type auto-détecté :
 *   <FormFieldAuto control={form.control} name="email" label="Email" type="email" />
 */
import { type ReactNode } from 'react';
import {
  Controller,
  type Control,
  type FieldPath,
  type FieldValues,
  type ControllerRenderProps,
} from 'react-hook-form';
import { Input }    from '../ui/Input';
import { Select, type SelectOption }  from '../ui/Select';
import { Textarea } from '../ui/Textarea';
import { Checkbox } from '../ui/Checkbox';
import { useI18n } from '../../lib/i18n/useI18n';

// ─── FormField générique ──────────────────────────────────────────────────────

interface FormFieldProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> {
  control:  Control<TFieldValues>;
  name:     TName;
  label?:   string;
  hint?:    string;
  children: (
    field: ControllerRenderProps<TFieldValues, TName>,
    error: string | undefined,
  ) => ReactNode;
}

export function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({ control, name, children }: FormFieldProps<TFieldValues, TName>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) =>
        <>{children(field, fieldState.error?.message)}</>
      }
    />
  );
}

// ─── FormFieldAuto — version "batteries included" ────────────────────────────

export type FieldType = 'text' | 'email' | 'password' | 'number' | 'tel' | 'url'
  | 'select' | 'textarea' | 'checkbox' | 'date';

interface FormFieldAutoProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>,
> {
  control:      Control<TFieldValues>;
  name:         TName;
  label?:       string;
  hint?:        string;
  placeholder?: string;
  type?:        FieldType;
  required?:    boolean;
  disabled?:    boolean;
  options?:     SelectOption[];           // Pour type='select'
  rows?:        number;                   // Pour type='textarea'
  showCount?:   boolean;                  // Pour type='textarea'
  maxLength?:   number;
}

export function FormFieldAuto<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  control, name, label, hint, placeholder, type = 'text',
  required, disabled, options, rows, showCount, maxLength,
}: FormFieldAutoProps<TFieldValues, TName>) {
  const { t } = useI18n();

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const error = fieldState.error?.message;

        if (type === 'checkbox') {
          return (
            <Checkbox
              label={label}
              hint={hint}
              error={error}
              checked={Boolean(field.value)}
              onCheckedChange={field.onChange}
              disabled={disabled}
              name={field.name}
              required={required}
            />
          );
        }

        if (type === 'select') {
          return (
            <Select
              {...field}
              label={label}
              hint={hint}
              error={error}
              options={options ?? []}
              placeholder={placeholder ?? t('formField.selectPlaceholder')}
              required={required}
              disabled={disabled}
            />
          );
        }

        if (type === 'textarea') {
          return (
            <Textarea
              {...field}
              label={label}
              hint={hint}
              error={error}
              placeholder={placeholder}
              required={required}
              disabled={disabled}
              rows={rows ?? 3}
              showCount={showCount}
              maxLength={maxLength}
              autoResize
            />
          );
        }

        return (
          <Input
            {...field}
            label={label}
            hint={hint}
            error={error}
            placeholder={placeholder}
            type={type}
            required={required}
            disabled={disabled}
            maxLength={maxLength}
          />
        );
      }}
    />
  );
}
