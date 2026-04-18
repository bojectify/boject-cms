export interface TextFieldConfig {
  type: 'text';
  key: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  readonly?: boolean;
}

export interface TextareaFieldConfig {
  type: 'textarea';
  key: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  rows?: number;
}

export interface NumberFieldConfig {
  type: 'number';
  key: string;
  label: string;
  required?: boolean;
  placeholder?: string;
}

export interface BooleanFieldConfig {
  type: 'boolean';
  key: string;
  label: string;
}

export interface DatetimeFieldConfig {
  type: 'datetime';
  key: string;
  label: string;
  required?: boolean;
}

export interface SelectFieldConfig {
  type: 'select';
  key: string;
  label: string;
  required?: boolean;
  options: { label: string; value: string }[];
}

export interface RelationFieldConfig {
  type: 'relation';
  key: string;
  label: string;
  required?: boolean;
  optionsEndpoint: string;
}

export interface RichtextFieldConfig {
  type: 'richtext';
  key: string;
  label: string;
}

export interface MultirelationFieldConfig {
  type: 'multirelation';
  key: string;
  label: string;
  optionsEndpoint: string;
}

export interface DynamicRelationFieldConfig {
  type: 'dynamic-relation';
  key: string;
  label: string;
  required?: boolean;
  targetContentTypeIds: string[];
}

export interface DynamicMultirelationFieldConfig {
  type: 'dynamic-multirelation';
  key: string;
  label: string;
  targetContentTypeIds: string[];
}

export interface ImageFieldConfig {
  type: 'image';
  key: string;
  label: string;
  required?: boolean;
}

export type FieldConfig =
  | TextFieldConfig
  | TextareaFieldConfig
  | NumberFieldConfig
  | BooleanFieldConfig
  | DatetimeFieldConfig
  | SelectFieldConfig
  | RelationFieldConfig
  | RichtextFieldConfig
  | MultirelationFieldConfig
  | DynamicRelationFieldConfig
  | DynamicMultirelationFieldConfig
  | ImageFieldConfig;
