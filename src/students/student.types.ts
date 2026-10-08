export type Student = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  dateOfBirth: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StudentRow = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  date_of_birth: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type CreateStudentInput = {
  firstName: string;
  lastName: string;
  email: string;
  dateOfBirth?: string | null;
};

export type UpdateStudentInput = Partial<CreateStudentInput>;

export type ListStudentsQuery = {
  limit: number;
  offset: number;
};

export type StudentList = {
  data: Student[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
};
