import { Routes } from '@angular/router';
import { DashboardComponent } from './pages/dashboard/dashboard.component';

// Fixture routes file for the Style QA angular route reader.
export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'dashboard', component: DashboardComponent, canActivate: [authGuard] },
  { path: 'settings', loadComponent: () => import('./pages/settings/settings.component').then((m) => m.SettingsComponent) },
  { path: 'settings/:id', loadComponent: () => import('./pages/settings/detail/detail.component').then((m) => m.DetailComponent) },
  {
    path: 'admin',
    component: AdminShellComponent,
    children: [
      { path: 'users', loadComponent: () => import('./admin/users.component').then((m) => m.UsersComponent) },
      { path: 'users/:userId', component: UserComponent, data: { title: 'User' } },
    ],
  },
  { path: 'reports', loadChildren: () => import('./reports/reports.routes').then((m) => m.REPORTS) },
  { path: 'logout', component: LogoutComponent },
  { path: '**', redirectTo: '' },
];
