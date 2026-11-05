import { z } from 'zod';

export const GoogleAuthSchema = z.object({
  idToken: z.string({
    required_error: 'Google ID Token is required',
  }).min(1, 'Google ID Token cannot be empty'),
});

export type GoogleAuthInput = z.infer<typeof GoogleAuthSchema>;

export const UpdateProfileSchema = z.object({
  name: z
    .string({
      required_error: 'Name is required',
    })
    .min(2, 'Name must be at least 2 characters')
    .max(60, 'Name cannot exceed 60 characters')
    .trim(),
  phone: z
    .string({
      required_error: 'Phone number is required',
    })
    .trim()
    // Indian mobile numbers: 10 digits starting with 6, 7, 8, or 9
    .regex(/^[6-9]\d{9}$/, 'Must be a valid 10-digit Indian mobile number (e.g. 9811223344)'),
  avatarUrl: z.string().url('Invalid avatar URL').optional().nullable(),
});

export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;
