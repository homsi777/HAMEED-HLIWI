import { IsString, Length, Matches } from 'class-validator';

export class LoginDto {
  @IsString() @Length(3, 80) @Matches(/^[A-Za-z0-9_.-]+$/)
  username!: string;
  @IsString() @Length(8, 200)
  password!: string;
}
