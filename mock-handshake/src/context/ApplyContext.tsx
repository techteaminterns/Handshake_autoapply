import React, { createContext, useContext, useState, ReactNode } from 'react';

export interface ApplyState {
  jobId: string | null;
  jobTitle: string | null;
  resumeFile: File | string | null;
  coverLetterFile: File | string | null;
}

export interface ApplyContextType {
  jobId: string | null;
  jobTitle: string | null;
  resumeFile: File | string | null;
  coverLetterFile: File | string | null;
  setJobId: (id: string | null) => void;
  setJobTitle: (title: string | null) => void;
  setResumeFile: (file: File | string | null) => void;
  setCoverLetterFile: (file: File | string | null) => void;
  setApplyData: (data: Partial<ApplyState>) => void;
  resetApplyData: () => void;
}

const defaultState: ApplyState = {
  jobId: null,
  jobTitle: null,
  resumeFile: null,
  coverLetterFile: null,
};

export const ApplyContext = createContext<ApplyContextType | null>(null);

export function ApplyProvider({ children }: { children: ReactNode }) {
  const [jobId, setJobId] = useState<string | null>(defaultState.jobId);
  const [jobTitle, setJobTitle] = useState<string | null>(defaultState.jobTitle);
  const [resumeFile, setResumeFile] = useState<File | string | null>(defaultState.resumeFile);
  const [coverLetterFile, setCoverLetterFile] = useState<File | string | null>(defaultState.coverLetterFile);

  const setApplyData = (data: Partial<ApplyState>) => {
    if (data.jobId !== undefined) setJobId(data.jobId);
    if (data.jobTitle !== undefined) setJobTitle(data.jobTitle);
    if (data.resumeFile !== undefined) setResumeFile(data.resumeFile);
    if (data.coverLetterFile !== undefined) setCoverLetterFile(data.coverLetterFile);
  };

  const resetApplyData = () => {
    setJobId(defaultState.jobId);
    setJobTitle(defaultState.jobTitle);
    setResumeFile(defaultState.resumeFile);
    setCoverLetterFile(defaultState.coverLetterFile);
  };

  return (
    <ApplyContext.Provider
      value={{
        jobId,
        jobTitle,
        resumeFile,
        coverLetterFile,
        setJobId,
        setJobTitle,
        setResumeFile,
        setCoverLetterFile,
        setApplyData,
        resetApplyData,
      }}
    >
      {children}
    </ApplyContext.Provider>
  );
}

export function useApplyContext(): ApplyContextType {
  const context = useContext(ApplyContext);
  if (!context) {
    throw new Error('useApplyContext must be used within an ApplyProvider');
  }
  return context;
}
