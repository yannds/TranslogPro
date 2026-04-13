/**
 * FormBuilder — Formulaire schema-driven (DRY ultime)
 *
 * Génère automatiquement un formulaire complet à partir d'un schema Zod
 * et d'une définition de champs. Zéro boilerplate côté page.
 *
 * Usage :
 *   const fields: FieldDef<typeof mySchema>[] = [
 *     { name: 'email',    label: 'Email',     type: 'email',    required: true },
 *     { name: 'role',     label: 'Rôle',      type: 'select',   options: roleOptions },
 *     { name: 'message',  label: 'Message',   type: 'textarea', rows: 4, showCount: true, maxLength: 500 },
 *   ];
 *
 *   <FormBuilder
 *     schema={mySchema}
 *     fields={fields}
 *     onSubmit={async (data) => await api.post('/users', data)}
 *     submitLabel="Créer l'utilisateur"
 *   />
 *
 * Layout : grille 1 ou 2 colonnes configurable par champ (colSpan)
 */
import { type ReactNode } from 'react';
import { useForm, type FieldPath, type FieldValues, type DefaultValues } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { type ZodType } from 'zod';
import { FormFieldAuto, type FieldType } from './FormField';
import { Button } from '../ui/Button';
import { cn }    from '../../lib/utils';
import type { SelectOption } from '../ui/Select';

export interface FieldDef<TSchema extends FieldValues> {
  name:         FieldPath<TSchema>;
  label?:       string;
  hint?:        string;
  placeholder?: string;
  type?:        FieldType;
  required?:    boolean;
  disabled?:    boolean;
  options?:     SelectOption[];
  rows?:        number;
  showCount?:   boolean;
  maxLength?:   number;
  colSpan?:     1 | 2;   // 2 = pleine largeur dans la grille 2 colonnes
}

interface FormBuilderProps<TSchema extends FieldValues> {
  schema:         ZodType<TSchema>;
  fields:         FieldDef<TSchema>[];
  defaultValues?: DefaultValues<TSchema>;
  onSubmit:       (data: TSchema) => Promise<void> | void;
  submitLabel?:   string;
  cancelLabel?:   string;
  onCancel?:      () => void;
  columns?:       1 | 2;
  /** Slot injecté entre les champs et le footer (ex : CGU checkbox) */
  extra?:         ReactNode;
  className?:     string;
}

export function FormBuilder<TSchema extends FieldValues>({
  schema,
  fields,
  defaultValues,
  onSubmit,
  submitLabel = 'Enregistrer',
  cancelLabel = 'Annuler',
  onCancel,
  columns = 1,
  extra,
  className,
}: FormBuilderProps<TSchema>) {
  const form = useForm<TSchema>({
    resolver:      zodResolver(schema),
    defaultValues,
    mode:          'onTouched',
  });

  const { handleSubmit, formState: { isSubmitting, errors } } = form;

  const hasErrors = Object.keys(errors).length > 0;

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className={cn('flex flex-col gap-4', className)}
    >
      {/* Grille de champs */}
      <div className={cn(
        'grid gap-4',
        columns === 2 && 'sm:grid-cols-2',
      )}>
        {fields.map(f => (
          <div
            key={f.name as string}
            className={cn(f.colSpan === 2 && 'sm:col-span-2')}
          >
            <FormFieldAuto
              control={form.control}
              name={f.name}
              label={f.label}
              hint={f.hint}
              placeholder={f.placeholder}
              type={f.type}
              required={f.required}
              disabled={f.disabled || isSubmitting}
              options={f.options}
              rows={f.rows}
              showCount={f.showCount}
              maxLength={f.maxLength}
            />
          </div>
        ))}
      </div>

      {/* Slot extra */}
      {extra}

      {/* Erreur globale */}
      {hasErrors && (
        <p role="alert" className="text-sm text-red-500 dark:text-red-400">
          Veuillez corriger les erreurs ci-dessus.
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-2">
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            {cancelLabel}
          </Button>
        )}
        <Button type="submit" loading={isSubmitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
