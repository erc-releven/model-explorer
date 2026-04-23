import ClearIcon from "@mui/icons-material/Clear";
import { IconButton, InputAdornment, TextField, type TextFieldProps } from "@mui/material";

interface ClearableInputProps extends Omit<TextFieldProps, "onChange" | "value"> {
  onChange: NonNullable<TextFieldProps["onChange"]>;
  onClear: () => void;
  value: string;
}

export function ClearableInput({ onClear, value, ...props }: ClearableInputProps) {
  const clearLabel = typeof props.label === "string" ? props.label : "input";

  return (
    <TextField
      {...props}
      slotProps={{
        ...props.slotProps,
        input: {
          endAdornment:
            value.length > 0 ? (
              <InputAdornment position="end">
                <IconButton
                  aria-label={`Clear ${clearLabel}`}
                  edge="end"
                  size="small"
                  onClick={onClear}
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ) : undefined,
        },
      }}
      value={value}
    />
  );
}
