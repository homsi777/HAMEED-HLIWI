import { IsString, Length, Matches } from 'class-validator';

export class LoginDto {
  @IsString() @Length(3, 80) @Matches(/^[A-Za-z0-9_.-]+$/)
  username!: string;
  @IsString() @Length(8, 200)
  password!: string;
  @IsString() @Matches(/^(system|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i)
  warehouseId!: string;
}
