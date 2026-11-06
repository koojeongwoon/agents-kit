import {afterEach,expect,it,vi} from 'vitest';
import {render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {ProjectContextPicker} from './ProjectContextPicker';
afterEach(()=>localStorage.clear());
it('selects a project with its Kit context without switching while a path is being typed',async()=>{
  const user=userEvent.setup(),select=vi.fn();render(<ProjectContextPicker name="default" path="" onSelect={select}/>);
  await user.type(screen.getByLabelText('프로젝트 경로'),'/work/first');expect(select).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button',{name:'프로젝트 선택'}));expect(select).toHaveBeenLastCalledWith('default','/work/first');
  await user.clear(screen.getByLabelText('프로젝트 경로'));await user.type(screen.getByLabelText('프로젝트 경로'),'/work/second');await user.click(screen.getByRole('button',{name:'프로젝트 선택'}));
  await user.selectOptions(screen.getByLabelText('최근 선택 프로젝트'),JSON.stringify(['default','/work/first']));expect(select).toHaveBeenLastCalledWith('default','/work/first');
});
