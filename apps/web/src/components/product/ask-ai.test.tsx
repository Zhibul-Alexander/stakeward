import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AskAi } from './ask-ai.tsx';

describe('AskAi', () => {
  it('links to the person own accounts with the question, in a new tab, and shows the question', () => {
    render(<AskAi prompt="What is this?" />);
    const chatgpt = screen.getByRole('link', { name: /Ask ChatGPT/ });
    expect(chatgpt).toHaveAttribute('href', 'https://chatgpt.com/?q=What%20is%20this%3F');
    expect(chatgpt).toHaveAttribute('target', '_blank');
    expect(chatgpt).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: /Ask Claude/ })).toHaveAttribute('href', 'https://claude.ai/new?q=What%20is%20this%3F');
    expect(screen.getByText('What is this?')).toBeInTheDocument();
    expect(screen.getByText(/Stakeward sends nothing, stores nothing/)).toBeInTheDocument();
  });
});
