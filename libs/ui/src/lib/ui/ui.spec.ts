import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Badge, Button, Card, Icon, Section } from '../../index';

describe('ui primitives', () => {
  it('exports Button, Card, Section, Badge, and Icon', () => {
    expect(Button).toBeTruthy();
    expect(Card).toBeTruthy();
    expect(Section).toBeTruthy();
    expect(Badge).toBeTruthy();
    expect(Icon).toBeTruthy();
  });
});

describe('Button', () => {
  let component: Button;
  let fixture: ComponentFixture<Button>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Button],
    }).compileComponents();

    fixture = TestBed.createComponent(Button);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders the primary variant by default', () => {
    const button = fixture.nativeElement.querySelector(
      'button',
    ) as HTMLButtonElement;

    expect(button).toBeTruthy();
    expect(button.classList.contains('bg-indigo-600')).toBe(true);
    expect(button.classList.contains('text-white')).toBe(true);
  });

  it('renders the secondary variant', () => {
    component.variant = 'secondary';
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector(
      'button',
    ) as HTMLButtonElement;

    expect(button.classList.contains('border-indigo-600')).toBe(true);
    expect(button.classList.contains('text-indigo-600')).toBe(true);
  });

  it('renders the ghost variant', () => {
    component.variant = 'ghost';
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector(
      'button',
    ) as HTMLButtonElement;

    expect(button.classList.contains('text-indigo-600')).toBe(true);
    expect(button.classList.contains('bg-indigo-600')).toBe(false);
  });
});

describe('Card', () => {
  let fixture: ComponentFixture<Card>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Card],
    }).compileComponents();

    fixture = TestBed.createComponent(Card);
    fixture.detectChanges();
  });

  it('renders a card surface', () => {
    const card = fixture.nativeElement.querySelector(
      'div',
    ) as HTMLDivElement;

    expect(card).toBeTruthy();
    expect(card.classList.contains('rounded-xl')).toBe(true);
    expect(card.classList.contains('bg-white')).toBe(true);
    expect(card.classList.contains('shadow-sm')).toBe(true);
  });
});

describe('Section', () => {
  let fixture: ComponentFixture<Section>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Section],
    }).compileComponents();

    fixture = TestBed.createComponent(Section);
    fixture.detectChanges();
  });

  it('renders a section wrapper', () => {
    const section = fixture.nativeElement.querySelector(
      'section',
    ) as HTMLElement;

    expect(section).toBeTruthy();
    expect(section.classList.contains('py-16')).toBe(true);
    expect(section.classList.contains('font-sans')).toBe(true);
  });
});

describe('Badge', () => {
  let fixture: ComponentFixture<Badge>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Badge],
    }).compileComponents();

    fixture = TestBed.createComponent(Badge);
    fixture.detectChanges();
  });

  it('renders an indigo badge', () => {
    const badge = fixture.nativeElement.querySelector(
      'span',
    ) as HTMLSpanElement;

    expect(badge).toBeTruthy();
    expect(badge.classList.contains('bg-indigo-50')).toBe(true);
    expect(badge.classList.contains('text-indigo-700')).toBe(true);
  });
});

describe('Icon', () => {
  let component: Icon;
  let fixture: ComponentFixture<Icon>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Icon],
    }).compileComponents();

    fixture = TestBed.createComponent(Icon);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders an inline svg icon', () => {
    const svg = fixture.nativeElement.querySelector('svg') as SVGSVGElement;

    expect(svg).toBeTruthy();
    expect(svg.getAttribute('fill')).toBe('none');
    expect(svg.classList.contains('h-5')).toBe(true);
    expect(svg.classList.contains('w-5')).toBe(true);
  });

  it('renders the calendar glyph when requested', () => {
    component.name = 'calendar';
    fixture.detectChanges();

    const path = fixture.nativeElement.querySelector('path') as SVGPathElement;

    expect(path.getAttribute('d')).toContain('M6.75 3v2.25');
  });

  it('renders the check glyph when requested', () => {
    component.name = 'check';
    fixture.detectChanges();

    const path = fixture.nativeElement.querySelector('path') as SVGPathElement;

    expect(path.getAttribute('d')).toContain('m4.5 12.75');
  });
});
