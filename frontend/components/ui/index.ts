/**
 * Core UI Library — Barrel export
 *
 * Import pattern (DRY) :
 *   import { Button, Input, Badge, Skeleton } from '@ui/index';
 */
export { Button, type ButtonProps }           from './Button';
export { Input, type InputProps }             from './Input';
export { Select, type SelectProps }           from './Select';
export { Textarea, type TextareaProps }       from './Textarea';
export { Checkbox, type CheckboxProps }       from './Checkbox';
export { Badge, type BadgeProps }             from './Badge';
export { Card, CardHeader, CardContent,
         CardFooter, type CardProps }         from './Card';
export { Skeleton, SkeletonText,
         SkeletonTable }                      from './Skeleton';
export { Dialog, type DialogProps }           from './Dialog';
